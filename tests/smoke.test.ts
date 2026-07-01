import { expect, test } from "bun:test";

import { garnishVersion } from "../src/index";

test("core entry point exports the placeholder version", () => {
  expect(garnishVersion).toBe("0.0.0");
});
