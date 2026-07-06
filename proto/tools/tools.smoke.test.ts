import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GarnishTool, ToolContext } from "../harness/types";
import { sandboxAvailability } from "../sandbox";
import { createCoreTools, scaffoldWorkspace } from "./index";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function freshHarness(sandbox: "seatbelt" | "none" = "none") {
  const root = mkdtempSync(join(tmpdir(), "garnish-tools-test-"));
  roots.push(root);
  const scaffold = scaffoldWorkspace({ root });
  const tools = createCoreTools({ ...scaffold, sandbox });
  const ctx: ToolContext = {
    sessionId: "test-session",
    messageId: "test-message",
    callId: "test-call",
    signal: new AbortController().signal,
    ...scaffold,
  };
  return { ...scaffold, tools, ctx };
}

function tool(tools: GarnishTool[], name: string): GarnishTool {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

describe("proto/tools core workspace tools", () => {
  test("read/write/edit round-trip exposes line numbers and edit details", async () => {
    const { tools, ctx } = freshHarness();

    const write = await tool(tools, "write").execute({ path: "notes/quest.txt", content: "bug\n" }, ctx);
    expect(write.isError).toBeFalsy();
    expect(write.details).toEqual({ fileEdited: { path: "notes/quest.txt", kind: "write", summary: "+4 bytes" } });

    const read = await tool(tools, "read").execute({ path: "notes/quest.txt" }, ctx);
    expect(read.output).toBe("1:bug\n2:");

    const edit = await tool(tools, "edit").execute({ path: "notes/quest.txt", oldString: "bug", newString: "fixed" }, ctx);
    expect(edit.isError).toBeFalsy();
    expect(edit.details).toEqual({ fileEdited: { path: "notes/quest.txt", kind: "edit", summary: "+5/-3 bytes" } });

    const reread = await tool(tools, "read").execute({ path: "notes/quest.txt" }, ctx);
    expect(reread.output).toBe("1:fixed\n2:");
  });

  test("edit refuses zero and duplicate exact matches", async () => {
    const { tools, ctx } = freshHarness();
    await tool(tools, "write").execute({ path: "dupes.txt", content: "same same" }, ctx);

    const none = await tool(tools, "edit").execute({ path: "dupes.txt", oldString: "missing", newString: "x" }, ctx);
    expect(none.isError).toBe(true);
    expect(none.output).toContain("matched 0 times");

    const duplicate = await tool(tools, "edit").execute({ path: "dupes.txt", oldString: "same", newString: "x" }, ctx);
    expect(duplicate.isError).toBe(true);
    expect(duplicate.output).toContain("matched 2 times");
  });

  test("file tools refuse workspace escapes", async () => {
    const { tools, ctx } = freshHarness();
    const result = await tool(tools, "read").execute({ path: "../outside.txt" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("only access files inside the workspace");
  });

  test("bash echo works without seatbelt", async () => {
    const { tools, ctx } = freshHarness("none");
    const result = await tool(tools, "bash").execute({ cmd: "echo hello" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("sandbox disabled");
    expect(result.output).toContain("hello");
    expect(result.details).toEqual(expect.objectContaining({ exitCode: 0 }));
  });
});

const seatbeltTest = process.platform === "darwin" && sandboxAvailability().mode === "seatbelt" ? test : test.skip;

describe("seatbelt bash sandbox", () => {
  seatbeltTest("blocks home writes and network while allowing workspace writes", async () => {
    const { tools, ctx, workspace } = freshHarness("seatbelt");
    const bash = tool(tools, "bash");

    const requestedEscape = await bash.execute({ cmd: "touch /tmp/../$HOME/garnish-proto-escape" }, ctx);
    expect(requestedEscape.isError).toBe(true);

    const homeWrite = await bash.execute({ cmd: "touch \"$HOME/garnish-proto-escape\"" }, ctx);
    expect(homeWrite.isError).toBe(true);
    expect(homeWrite.output).toContain("sandbox blocked");

    const network = await bash.execute({ cmd: "curl -I --max-time 2 https://example.com" }, ctx);
    expect(network.isError).toBe(true);
    expect(network.output).toContain("sandbox blocked");

    const workspaceWrite = await bash.execute({ cmd: "touch sandbox-ok && test -f sandbox-ok && pwd" }, ctx);
    expect(workspaceWrite.isError).toBe(false);
    expect(workspaceWrite.output).toContain(workspace);
  });
});
