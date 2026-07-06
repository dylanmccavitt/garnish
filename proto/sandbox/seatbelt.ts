import { existsSync, realpathSync } from "node:fs";
import { delimiter } from "node:path";

export interface SandboxAvailability {
  mode: "seatbelt" | "none";
  reason: string;
}

export interface BuildProfileOptions {
  workspace: string;
  sessionTemp: string;
  allowNetwork: boolean;
}

function onPath(command: string): boolean {
  const paths = (process.env.PATH ?? "").split(delimiter);
  return paths.some((dir) => existsSync(`${dir}/${command}`));
}

function q(path: string): string {
  return JSON.stringify(path);
}

function subpath(path: string): string {
  return `(subpath ${q(path)})`;
}

function literal(path: string): string {
  return `(literal ${q(path)})`;
}

export function sandboxAvailability(): SandboxAvailability {
  if (process.platform !== "darwin") {
    return { mode: "none", reason: `sandbox-exec/Seatbelt is unavailable on ${process.platform}; bash will run without OS sandboxing.` };
  }
  if (!onPath("sandbox-exec")) {
    return { mode: "none", reason: "sandbox-exec is not on PATH; bash will run without OS sandboxing." };
  }
  return { mode: "seatbelt", reason: "sandbox-exec is available; bash will run under a generated Seatbelt profile." };
}

export function buildProfile(opts: BuildProfileOptions): string {
  const home = process.env.HOME;

  const workspace = realpathSync(opts.workspace);
  const sessionTemp = realpathSync(opts.sessionTemp);
  const protectedWritePaths = [
    `${workspace}/.git`,
    `${workspace}/.garnish`,
    `${workspace}/.env`,
    `${workspace}/.ssh`,
  ];
  if (home) {
    protectedWritePaths.push(
      `${home}/.ssh`,
      `${home}/.env`,
      `${home}/.bashrc`,
      `${home}/.bash_profile`,
      `${home}/.zshrc`,
      `${home}/.zprofile`,
      `${home}/.profile`,
    );
  }

  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow file-read-metadata)",
    "(allow file-read*)",
    `(allow file-write* ${[workspace, sessionTemp].map(subpath).join(" ")})`,
    `(deny file-write* ${protectedWritePaths.map((path) => path.endsWith("/.env") || !existsSync(path) ? literal(path) : subpath(path)).join(" ")})`,
    opts.allowNetwork ? "(allow network*)" : "(deny network*)",
    "",
  ].join("\n");
}
