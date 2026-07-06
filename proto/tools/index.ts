import type { GarnishTool } from "../harness/types";
import { createBashTool } from "./bash";
import { createEditTool, createReadTool, createWriteTool } from "./core";

export interface CreateCoreToolsOptions {
  workspace: string;
  sessionTemp: string;
  sandbox: "seatbelt" | "none";
}

export function createCoreTools(opts: CreateCoreToolsOptions): GarnishTool[] {
  return [createReadTool(), createWriteTool(), createEditTool(), createBashTool(opts)];
}

export { scaffoldWorkspace } from "./workspace";
export type { ScaffoldedWorkspace, ScaffoldWorkspaceOptions } from "./workspace";
