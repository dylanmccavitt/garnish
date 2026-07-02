import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { appendFile, cp, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  parseOmpVersion,
  runtimePaths,
  type GateConfigEffects,
  type InstallRuntimeRequest,
  type LaunchSpec,
  type RuntimeEffects,
} from "../adapter";
import { initCommand, type InitFsEffects, type Prompter } from "./init";
import { main, type CliDeps, type CommandOutcome, type DoctorDeps } from "./index";
import { createFsEventStore, loadInstalledState } from "./state";

/**
 * Real-dependency composition root: everything `bun run garnish …` wires together.
 * Command cores stay dependency-injected; this file is the only place that binds them
 * to the machine (fs, child processes, stdin, Bun.build, the Garnish root on disk).
 */

export interface RunGarnishOptions {
  /** Garnish-owned storage root. Default: $GARNISH_ROOT, else ~/.garnish. */
  readonly rootDir?: string;
  /** Environment snapshot consulted for GARNISH_ROOT / GARNISH_OMP_SOURCE. Default: process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Prompter for `init`. Default: interactive/piped stdin. */
  readonly prompter?: Prompter;
  /** Launch effect for `init`. Default: spawn the certified binary in the sandbox. */
  readonly launch?: (spec: LaunchSpec) => void | Promise<void>;
  /** Repo root that holds packs/ and src/extension/entry.ts. Default: this checkout. */
  readonly repoRootDir?: string;
}

export async function runGarnish(
  argv: readonly string[],
  options: RunGarnishOptions = {},
): Promise<CommandOutcome> {
  const env = options.env ?? process.env;
  const rootDir = resolve(options.rootDir ?? env.GARNISH_ROOT ?? join(homedir(), ".garnish"));
  const repoRootDir = options.repoRootDir ?? resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const [command, ...rest] = argv;

  try {
    if (command === "init") {
      return await runInit(rest, { rootDir, repoRootDir, env, options });
    }

    const paths = runtimePaths({ garnishRootDir: rootDir });
    const installed = loadInstalledState(paths.agentDir);
    const cli: CliDeps = {
      graph: installed.graph,
      quests: installed.quests,
      store: createFsEventStore(installed.eventsPath),
      now: () => new Date().toISOString(),
      runtimePaths: paths,
      gateEffects: realGateEffects(),
    };
    const doctor: DoctorDeps = {
      runtimeInstalled: () => existsSync(paths.binaryPath),
      reportedVersion: () => {
        const result = spawnSync(paths.binaryPath, ["--version"], { encoding: "utf8" });
        return result.status === 0 ? `${result.stdout}\n${result.stderr}`.trim() : undefined;
      },
      isolatedConfigPresent: () => existsSync(join(paths.agentDir, "config.yml")),
    };
    return await main(argv, { cli, doctor });
  } catch (error) {
    return { text: error instanceof Error ? error.message : `${error}`, exitCode: 1 };
  }
}

interface InitContext {
  readonly rootDir: string;
  readonly repoRootDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly options: RunGarnishOptions;
}

async function runInit(args: readonly string[], context: InitContext): Promise<CommandOutcome> {
  const noLaunch = args.includes("--no-launch");
  const prompter = context.options.prompter ?? createStdinPrompter();
  const launch =
    context.options.launch ??
    (noLaunch
      ? () => {}
      : async (spec: LaunchSpec) => {
          await launchInherited(spec);
        });

  try {
    const result = await initCommand({
      garnishRootDir: context.rootDir,
      packSourceDirs: corePackSourceDirs(context.repoRootDir),
      prompter,
      runtimeEffects: realRuntimeEffects(context.env),
      gateEffects: realGateEffects(),
      fs: realInitFs(),
      installExtension: async (agentDir) => {
        await bundleExtension(context.repoRootDir, agentDir);
      },
      launch,
      now: () => new Date().toISOString(),
    });
    if (result.exitCode === 0) {
      writeGarnishShim(context.rootDir, context.repoRootDir);
    }
    return result;
  } finally {
    if (context.options.prompter === undefined && "close" in prompter) {
      (prompter as StdinPrompter).close();
    }
  }
}

/** Core packs ship in-repo; level order === lexicographic dir order (l0-, l1-, …). */
function corePackSourceDirs(repoRootDir: string): readonly string[] {
  const packsRoot = join(repoRootDir, "packs", "core");
  return readdirSync(packsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(packsRoot, entry.name, "pack.yml")))
    .map((entry) => join(packsRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Real certified-runtime installer (ADR-9): Garnish owns the runtime copy. The binary
 * source is $GARNISH_OMP_SOURCE (explicit path — used by hermetic tests and offline
 * installs) or a host `omp` whose --version already matches the certified release.
 * A pinned network download is deliberately out of v1 scope: no published artifact URL
 * exists in the adapter contract, and installs must stay deterministic.
 */
function realRuntimeEffects(env: Readonly<Record<string, string | undefined>>): RuntimeEffects {
  return {
    exists: (path) => existsSync(path),
    mkdirp: (path) => {
      mkdirSync(path, { recursive: true });
    },
    installRuntime: (request: InstallRuntimeRequest) => {
      const source = resolveOmpSource(env, request);
      mkdirSync(dirname(request.paths.binaryPath), { recursive: true });
      copyFileSync(source, request.paths.binaryPath);
      chmodSync(request.paths.binaryPath, 0o755);
    },
    execFile: (file, args, execOptions) => {
      const result = spawnSync(file, [...args], {
        cwd: execOptions?.cwd,
        env: { ...process.env, ...(execOptions?.env ?? {}) },
        encoding: "utf8",
      });
      if (result.error !== undefined) {
        throw result.error;
      }
      return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
    },
  };
}

function resolveOmpSource(
  env: Readonly<Record<string, string | undefined>>,
  request: InstallRuntimeRequest,
): string {
  const explicit = env.GARNISH_OMP_SOURCE;
  if (explicit !== undefined && explicit.length > 0) {
    if (!existsSync(explicit)) {
      throw new Error(`GARNISH_OMP_SOURCE points at a missing file: ${explicit}`);
    }
    return explicit;
  }

  const hostBinary = Bun.which("omp");
  if (hostBinary === null) {
    throw new Error(
      [
        `No certified Pi runtime source found. Garnish needs omp ${request.version}.`,
        "Either install omp on PATH at the certified version, or set GARNISH_OMP_SOURCE to a binary path.",
      ].join("\n"),
    );
  }

  const versionResult = spawnSync(hostBinary, ["--version"], { encoding: "utf8" });
  const reported = parseOmpVersion(`${versionResult.stdout ?? ""}\n${versionResult.stderr ?? ""}`);
  if (reported !== request.version) {
    throw new Error(
      [
        `Host omp at ${hostBinary} reports ${reported ?? "unknown"}, but Garnish is certified for ${request.version}.`,
        "Set GARNISH_OMP_SOURCE to a binary of the certified version to install anyway.",
      ].join("\n"),
    );
  }
  return hostBinary;
}

function realGateEffects(): GateConfigEffects {
  return {
    mkdirp: (path) => {
      mkdirSync(path, { recursive: true });
    },
    writeFile: async (path, content) => {
      await writeFile(path, content, "utf8");
    },
    readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
  };
}

function realInitFs(): InitFsEffects {
  return {
    mkdirp: async (path) => {
      await mkdir(path, { recursive: true });
    },
    writeFile: async (path, content) => {
      await writeFile(path, content, "utf8");
    },
    copyDir: async (source, destination) => {
      await cp(source, destination, { recursive: true });
    },
    appendFile: async (path, content) => {
      await appendFile(path, content, "utf8");
    },
  };
}

/**
 * Bundle the real extension composition into the agent dir. The LOO-118 live-demo
 * lesson: omp loads a single synchronous .js (`bun build --target node`), never a
 * raw .ts with repo-absolute imports.
 */
export async function bundleExtension(repoRootDir: string, agentDir: string): Promise<string> {
  const entrypoint = join(repoRootDir, "src", "extension", "entry.ts");
  const outDir = join(agentDir, "extensions", "garnish");
  const build = await Bun.build({
    entrypoints: [entrypoint],
    target: "node",
    format: "esm",
  });
  if (!build.success || build.outputs.length === 0) {
    const logs = build.logs.map((log) => `${log}`).join("\n");
    throw new Error(`Extension bundle failed:\n${logs}`);
  }

  mkdirSync(outDir, { recursive: true });
  const bundlePath = join(outDir, "index.js");
  await writeFile(bundlePath, await build.outputs[0]!.text(), "utf8");
  return bundlePath;
}

/**
 * Shim so `garnish …` works from inside the learner's session (the extension's
 * command probe resolves {root}/bin/garnish) and from any shell without PATH games.
 */
function writeGarnishShim(rootDir: string, repoRootDir: string): string {
  const binDir = join(rootDir, "bin");
  const shimPath = join(binDir, "garnish");
  mkdirSync(binDir, { recursive: true });
  const script = [
    "#!/bin/sh",
    `GARNISH_ROOT="${rootDir}" exec "${process.execPath}" "${join(repoRootDir, "src", "bin.ts")}" "$@"`,
    "",
  ].join("\n");
  writeFileSync(shimPath, script, "utf8");
  chmodSync(shimPath, 0o755);
  return shimPath;
}

interface StdinPrompter extends Prompter {
  readonly close: () => void;
}

function createStdinPrompter(): StdinPrompter {
  if (process.stdin.isTTY !== true) {
    // Piped/non-interactive init (PRD proof plan: "answers piped"): readline drops
    // lines buffered before question() attaches, so consume stdin wholesale instead.
    const lines = readFileSync(0, "utf8").split("\n");
    let index = 0;
    return {
      ask: (question: string, defaultAnswer?: string): string => {
        const answer = (lines[index] ?? "").trim();
        index += 1;
        const hint = defaultAnswer === undefined ? "" : ` (default: ${defaultAnswer})`;
        console.log(`${question}${hint} ${answer}`);
        return answer;
      },
      close: () => {},
    };
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: async (question: string, defaultAnswer?: string): Promise<string> => {
      const hint = defaultAnswer === undefined ? "" : ` (default: ${defaultAnswer})`;
      return await rl.question(`${question}${hint} `);
    },
    close: () => {
      rl.close();
    },
  };
}

async function launchInherited(spec: LaunchSpec): Promise<number> {
  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: "inherit",
  });
  const { promise, resolve: resolveExit, reject } = Promise.withResolvers<number>();
  child.once("exit", (code) => {
    resolveExit(code ?? 0);
  });
  child.once("error", reject);
  return await promise;
}
