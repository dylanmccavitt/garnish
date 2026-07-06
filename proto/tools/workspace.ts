import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface ScaffoldWorkspaceOptions {
  root?: string;
}

export interface ScaffoldedWorkspace {
  workspace: string;
  sessionTemp: string;
}

function runGit(workspace: string, args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], { cwd: workspace, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

export function scaffoldWorkspace(opts: ScaffoldWorkspaceOptions = {}): ScaffoldedWorkspace {
  const root = opts.root ? resolve(opts.root) : mkdtempSync(join(tmpdir(), "garnish-proto-"));
  mkdirSync(root, { recursive: true });

  const workspace = join(root, "workspace");
  const sessionTemp = join(root, "session-temp");
  if (existsSync(join(workspace, ".git"))) {
    mkdirSync(sessionTemp, { recursive: true });
    return { workspace, sessionTemp };
  }
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(sessionTemp, { recursive: true });

  writeFileSync(join(workspace, "README.md"), "# Garnish prototype workspace\n\nFix the tiny greeter bug in `src/greet.ts`.\n", "utf8");
  writeFileSync(join(workspace, "src", "greet.ts"), "export function greet(name: string): string {\n  return `Goodbye, ${name}!`;\n}\n", "utf8");

  runGit(workspace, ["init"]);
  runGit(workspace, ["config", "user.name", "Garnish Prototype"]);
  runGit(workspace, ["config", "user.email", "garnish-proto@example.invalid"]);
  runGit(workspace, ["add", "README.md", "src/greet.ts"]);
  runGit(workspace, ["commit", "-m", "Initial prototype workspace"]);

  return { workspace, sessionTemp };
}
