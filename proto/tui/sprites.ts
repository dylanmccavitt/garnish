import { PIXEL_SPRITES } from "./pixel-sprites";

export const MASCOT_NAME = "Sprig";

const poses = {
  idle: PIXEL_SPRITES.sprigIdle,
  celebrate: PIXEL_SPRITES.sprigCelebrate,
  warn: PIXEL_SPRITES.sprigIdle,
  think: PIXEL_SPRITES.sprigIdle,
} as const;

export type MascotPose = keyof typeof poses;

export function mascot(pose: MascotPose): string[] {
  return [...poses[pose].ansi];
}

const burstFrames = ["·", "•", "◦", "•"] as const;

export function xpBurst(frame: number): string {
  return burstFrames[Math.abs(frame) % burstFrames.length];
}

export function unlockBanner(tools: string[]): string[] {
  const names = tools.length > 0 ? tools.join(" · ") : "tool";
  return [`▸▸ NEW VERB · ${names} ◂◂`];
}
