import { expect, test } from "bun:test";

import { evaluateCheck, type Check, type EvaluationContext, type Probes } from "../../src/index";

function probesWithFiles(files: Readonly<Record<string, string>>): Probes {
  return {
    fileExists: (path: string) => path in files,
    readFile: (path: string) => {
      const content = files[path];
      if (content === undefined) {
        throw new Error(`missing fixture file ${path}`);
      }
      return content;
    },
    runCommand: () => {
      throw new Error("unexpected command");
    },
    mcpHandshake: () => {
      throw new Error("unexpected MCP handshake");
    },
    skillValid: () => {
      throw new Error("unexpected skill validation");
    },
    confirm: () => {
      throw new Error("unexpected confirmation");
    },
  };
}

function ctx(files: Readonly<Record<string, string>>): EvaluationContext {
  return { probes: probesWithFiles(files) };
}

const providersMapConfig = [
  "providers:",
  "  anthropic:",
  "    apiKeyRef: ANTHROPIC_API_KEY",
  "  openai: {}",
].join("\n");

const providersArrayConfig = ["providers:", "  - apiKeyRef: OPENAI_API_KEY", "  - {}"].join("\n");

const emptyProvidersConfig = "providers: {}";

const yamlWildcardCheck = {
  type: "yaml_path",
  file: "config.yml",
  path: "$.providers[*].apiKeyRef",
  assert: "non_empty",
} satisfies Check;

test("yaml_path [*] wildcard passes when any map value has a non-empty key reference", async () => {
  const result = await evaluateCheck(yamlWildcardCheck, ctx({ "config.yml": providersMapConfig }));

  expect(result.status).toBe("pass");
  expect(result.evidence.details?.value).toEqual(["ANTHROPIC_API_KEY"]);
});

test("yaml_path [*] wildcard passes over array elements", async () => {
  const result = await evaluateCheck(yamlWildcardCheck, ctx({ "config.yml": providersArrayConfig }));

  expect(result.status).toBe("pass");
});

test("yaml_path [*] wildcard fails on an empty container", async () => {
  const result = await evaluateCheck(yamlWildcardCheck, ctx({ "config.yml": emptyProvidersConfig }));

  expect(result.status).toBe("fail");
});

test("yaml_path [*] wildcard fails when the container is missing", async () => {
  const result = await evaluateCheck(yamlWildcardCheck, ctx({ "config.yml": "other: true" }));

  expect(result.status).toBe("fail");
});

test("yaml_path [*] wildcard fails when every matched value is empty", async () => {
  const config = ["providers:", "  anthropic:", '    apiKeyRef: ""'].join("\n");
  const result = await evaluateCheck(yamlWildcardCheck, ctx({ "config.yml": config }));

  expect(result.status).toBe("fail");
});

test("json_path [*] wildcard works with equals assertion over arrays", async () => {
  const check = {
    type: "json_path",
    file: "state.json",
    path: "$.items[*].kind",
    assert: { equals: "badge" },
  } satisfies Check;
  const files = { "state.json": JSON.stringify({ items: [{ kind: "xp" }, { kind: "badge" }] }) };

  const result = await evaluateCheck(check, ctx(files));

  expect(result.status).toBe("pass");
});

test("json_path missing assertion passes when the wildcard matches nothing", async () => {
  const check = {
    type: "json_path",
    file: "state.json",
    path: "$.items[*].kind",
    assert: "missing",
  } satisfies Check;

  const result = await evaluateCheck(check, ctx({ "state.json": JSON.stringify({ items: [] }) }));

  expect(result.status).toBe("pass");
});

test("non-wildcard paths keep exact single-value semantics", async () => {
  const check = {
    type: "json_path",
    file: "state.json",
    path: "$.runtime.certifiedVersion",
    assert: "non_empty",
  } satisfies Check;
  const files = { "state.json": JSON.stringify({ runtime: { certifiedVersion: "16.2.13" } }) };

  const result = await evaluateCheck(check, ctx(files));

  expect(result.status).toBe("pass");
  expect(result.evidence.details?.value).toBe("16.2.13");
});
