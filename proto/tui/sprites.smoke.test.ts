import { describe, expect, test } from "bun:test";
import { PIXEL_SPRITES } from "./pixel-sprites";
import { MASCOT_NAME, mascot, unlockBanner, xpBurst } from "./sprites";

const poses = ["idle", "celebrate", "warn", "think"] as const;

describe("monogrid pixel sprites", () => {
  test("mascot text-mode rows are backed by baked pixel art", () => {
    expect(MASCOT_NAME).toBe("Sprig");
    expect(mascot("idle")).toEqual([...PIXEL_SPRITES.sprigIdle.ansi]);
    expect(mascot("celebrate")).toEqual([...PIXEL_SPRITES.sprigCelebrate.ansi]);

    for (const pose of poses) {
      const rows = mascot(pose);
      const baked = pose === "celebrate" ? PIXEL_SPRITES.sprigCelebrate.ansi : PIXEL_SPRITES.sprigIdle.ansi;

      expect(rows).toEqual([...baked]);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.join("")).toContain("\u001B[");
      expect(rows.join("")).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });

  test("xp burst cycles through restrained sparkle frames", () => {
    const frames = [xpBurst(0), xpBurst(1), xpBurst(2), xpBurst(3)];

    expect(frames).toEqual(["·", "•", "◦", "•"]);
    expect(xpBurst(4)).toBe(frames[0]);
    expect(xpBurst(-1)).toBe(frames[1]);
  });

  test("unlock banner announces tool names", () => {
    const banner = unlockBanner(["edit", "bash"]);

    expect(banner).toHaveLength(1);
    expect(banner[0]).toBe("▸▸ NEW VERB · edit · bash ◂◂");
    expect(banner.join("")).not.toMatch(/[░▒▓═]/);
    expect(banner.join("\n")).toContain("NEW VERB");
    expect(banner.join("\n")).toContain("edit");
    expect(banner.join("\n")).toContain("bash");
  });
});
