import { z } from "zod";
import type { GarnishTool, ToolContext, ToolResult } from "../harness/types";
import { buildProfile } from "../sandbox/seatbelt";
import { truncateForModel } from "./core";

const bashSchema = z.object({ cmd: z.string().min(1) });

export interface CreateBashToolOptions {
  workspace: string;
  sessionTemp: string;
  sandbox: "seatbelt" | "none";
}

function sandboxBlocked(exitCode: number, text: string): boolean {
  return exitCode !== 0 && ((exitCode === 134 && text.length === 0) || /Operation not permitted|Sandbox:|deny\(|not permitted|network.*denied|Could not resolve host|Failed to connect/i.test(text));
}

function blockedMessage(text: string): string {
  const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? "operation denied";
  return `The sandbox blocked this command (${firstLine}). Reads from system paths and the workspace are allowed, but writes are limited to the workspace and session temp, protected paths stay locked, and network is off by default.`;
}

async function readPipe(pipe: ReadableStream<Uint8Array> | null): Promise<string> {
  return pipe ? await new Response(pipe).text() : "";
}

export function createBashTool(opts: CreateBashToolOptions): GarnishTool {
  return {
    name: "bash",
    description: "Run a bash command in the workspace. On macOS it uses sandbox-exec; elsewhere it loudly degrades.",
    params: bashSchema,
    async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
      const parsed = bashSchema.safeParse(args);
      if (!parsed.success) return { isError: true, output: z.prettifyError(parsed.error) };

      const started = Date.now();
      const profile = opts.sandbox === "seatbelt"
        ? buildProfile({ workspace: ctx.workspace, sessionTemp: ctx.sessionTemp, allowNetwork: false })
        : undefined;
      const argv = profile
        ? ["sandbox-exec", "-p", profile, "bash", "-lc", parsed.data.cmd]
        : ["bash", "-lc", parsed.data.cmd];

      const proc = Bun.spawn(argv, {
        cwd: ctx.workspace,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        env: { ...process.env, GARNISH_SESSION_TEMP: ctx.sessionTemp },
      });

      let settled = false;
      const stop = (reason: string) => {
        if (!settled) {
          try { proc.kill("SIGTERM"); } catch { /* ignore */ }
          setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* ignore */ } }, 500);
        }
        return reason;
      };
      const timeout = setTimeout(() => stop("timed out after 30s"), 30_000);
      const abort = () => stop("aborted");
      ctx.signal.addEventListener("abort", abort, { once: true });

      try {
        const [stdout, stderr, exitCode] = await Promise.all([readPipe(proc.stdout), readPipe(proc.stderr), proc.exited]);
        settled = true;
        const durationMs = Date.now() - started;
        const merged = [stdout, stderr].filter(Boolean).join(stdout && stderr ? "\n" : "");
        const details = { exitCode, durationMs };
        if (opts.sandbox === "seatbelt" && sandboxBlocked(exitCode, merged)) return { isError: true, output: blockedMessage(merged), details };
        const warning = opts.sandbox === "none" ? "[sandbox disabled: Seatbelt unavailable; command ran without OS sandboxing]\n" : "";
        return { isError: exitCode !== 0, output: truncateForModel(`${warning}${merged}`), details };
      } finally {
        clearTimeout(timeout);
        ctx.signal.removeEventListener("abort", abort);
      }
    },
  };
}
