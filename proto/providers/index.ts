import { z } from "zod";

import type { ToolDescriptor } from "../harness/types";

export interface SerializedTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export function serializeToolParams(tool: ToolDescriptor): SerializedTool {
  const schema = z.toJSONSchema(tool.params) as Record<string, unknown>;
  return {
    name: tool.name,
    description: tool.description,
    schema: schema.type === "object" ? schema : { type: "object", properties: {}, additionalProperties: false },
  };
}

export { resolveAuth } from "./auth";
export { anthropicStream } from "./anthropic";
export { openaiStream } from "./openai";
