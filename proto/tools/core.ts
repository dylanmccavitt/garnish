import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { GarnishTool, ToolContext, ToolResult } from "../harness/types";

const MAX_LINES = 2_000;
const MAX_BYTES = 100 * 1024;

interface ResolvedPath {
  relPath: string;
  absPath: string;
}

const pathSchema = z.object({ path: z.string().min(1) });
const writeSchema = pathSchema.extend({ content: z.string() });
const editSchema = pathSchema.extend({ oldString: z.string().min(1), newString: z.string() });

function lineNumber(text: string): string {
  const lines = text.split("\n");
  return lines.map((line, index) => `${index + 1}:${line}`).join("\n");
}

function truncateForModel(text: string): string {
  const encoded = new TextEncoder().encode(text);
  const lines = text.split("\n");
  if (encoded.length <= MAX_BYTES && lines.length <= MAX_LINES) {
    return text;
  }

  let takenBytes = 0;
  const taken: string[] = [];
  for (const line of lines.slice(0, MAX_LINES)) {
    const lineBytes = new TextEncoder().encode(`${line}\n`).length;
    if (takenBytes + lineBytes > MAX_BYTES) break;
    taken.push(line);
    takenBytes += lineBytes;
  }
  return `[truncated: showing ${taken.length}/${lines.length} lines and ${takenBytes}/${encoded.length} bytes]\n${taken.join("\n")}`;
}

function workspaceContains(workspace: string, candidate: string): boolean {
  const rel = relative(workspace, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function resolveWorkspacePath(ctx: ToolContext, rawPath: string, forWrite: boolean): Promise<ResolvedPath | ToolResult> {
  const workspace = await realpath(resolve(ctx.workspace));
  const lexical = resolve(workspace, rawPath);
  if (!workspaceContains(workspace, lexical)) {
    return {
      isError: true,
      output: `Refused path ${JSON.stringify(rawPath)}: tools may only access files inside the workspace. Use a relative path under ${workspace}.`,
    };
  }

  let checked = lexical;
  try {
    checked = await realpath(lexical);
  } catch {
    if (forWrite) {
      try {
        checked = resolve(await realpath(dirname(lexical)), lexical.split(sep).at(-1) ?? "");
      } catch {
        checked = lexical;
      }
    }
  }

  if (!workspaceContains(workspace, checked)) {
    return {
      isError: true,
      output: `Refused path ${JSON.stringify(rawPath)}: it resolves outside the workspace through ${checked}. Workspace symlinks may read system paths only through bash, not core file tools.`,
    };
  }

  return { relPath: relative(workspace, lexical), absPath: lexical };
}

export function createReadTool(): GarnishTool {
  return {
    name: "read",
    description: "Read a workspace file and return line-numbered contents.",
    params: pathSchema,
    async execute(args, ctx) {
      const parsed = pathSchema.safeParse(args);
      if (!parsed.success) return { isError: true, output: z.prettifyError(parsed.error) };
      const resolvedPath = await resolveWorkspacePath(ctx, parsed.data.path, false);
      if (!("absPath" in resolvedPath)) return resolvedPath;

      try {
        const content = await readFile(resolvedPath.absPath, "utf8");
        return { output: truncateForModel(lineNumber(content)), details: { path: resolvedPath.relPath, bytes: Buffer.byteLength(content) } };
      } catch (error) {
        return { isError: true, output: `Could not read ${resolvedPath.relPath}: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  };
}

export function createWriteTool(): GarnishTool {
  return {
    name: "write",
    description: "Write a workspace file, creating parent directories as needed.",
    params: writeSchema,
    async execute(args, ctx) {
      const parsed = writeSchema.safeParse(args);
      if (!parsed.success) return { isError: true, output: z.prettifyError(parsed.error) };
      const resolvedPath = await resolveWorkspacePath(ctx, parsed.data.path, true);
      if (!("absPath" in resolvedPath)) return resolvedPath;

      await mkdir(dirname(resolvedPath.absPath), { recursive: true });
      await writeFile(resolvedPath.absPath, parsed.data.content, "utf8");
      const bytes = Buffer.byteLength(parsed.data.content);
      return {
        output: `Wrote ${resolvedPath.relPath} (+${bytes} bytes).`,
        details: { fileEdited: { path: resolvedPath.relPath, kind: "write", summary: `+${bytes} bytes` } },
      };
    },
  };
}

export function createEditTool(): GarnishTool {
  return {
    name: "edit",
    description: "Replace one exact string in a workspace file.",
    params: editSchema,
    async execute(args, ctx) {
      const parsed = editSchema.safeParse(args);
      if (!parsed.success) return { isError: true, output: z.prettifyError(parsed.error) };
      const resolvedPath = await resolveWorkspacePath(ctx, parsed.data.path, false);
      if (!("absPath" in resolvedPath)) return resolvedPath;

      let content: string;
      try {
        content = await readFile(resolvedPath.absPath, "utf8");
      } catch (error) {
        return { isError: true, output: `Could not edit ${resolvedPath.relPath}: ${error instanceof Error ? error.message : String(error)}` };
      }

      const matches = content.split(parsed.data.oldString).length - 1;
      if (matches !== 1) {
        return { isError: true, output: `Exact edit refused for ${resolvedPath.relPath}: oldString matched ${matches} times; it must match exactly once.` };
      }

      const next = content.replace(parsed.data.oldString, parsed.data.newString);
      await writeFile(resolvedPath.absPath, next, "utf8");
      const added = Buffer.byteLength(parsed.data.newString);
      const removed = Buffer.byteLength(parsed.data.oldString);
      return {
        output: `Edited ${resolvedPath.relPath} (+${added}/-${removed} bytes).`,
        details: { fileEdited: { path: resolvedPath.relPath, kind: "edit", summary: `+${added}/-${removed} bytes` } },
      };
    },
  };
}

export { truncateForModel };
