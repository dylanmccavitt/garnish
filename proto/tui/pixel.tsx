/** @jsxImportSource @opentui/react */
import { StyledText, bg, fg, type TextChunk } from "@opentui/core";
import type { ReactNode } from "react";
import type { PixelCell, PixelSprite } from "./pixel-sprites";
import { theme } from "./theme";

const EMPTY = theme.bg;
const DIM_TARGET = "#8A8A8F";

function parseHex(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return `#${toHex(ar + (br - ar) * amount)}${toHex(ag + (bg - ag) * amount)}${toHex(ab + (bb - ab) * amount)}`;
}

function spriteColor(color: string | null, dim: boolean): string {
  if (!color) return EMPTY;
  return dim ? mix(color, DIM_TARGET, 0.58) : color;
}

function cellStyle([top, bottom]: PixelCell, dim: boolean): { fgColor: string; bgColor: string; text: string } {
  if (!top && !bottom) return { fgColor: EMPTY, bgColor: EMPTY, text: " " };
  return {
    fgColor: spriteColor(top, dim),
    bgColor: spriteColor(bottom, dim),
    text: "▀",
  };
}


function rowToStyledText(row: PixelCell[], dim: boolean): StyledText {
  const chunks: TextChunk[] = [];
  let runText = "";
  let runFg = "";
  let runBg = "";

  for (const cell of row) {
    const style = cellStyle(cell, dim);
    if (runText && (style.fgColor !== runFg || style.bgColor !== runBg)) {
      chunks.push(bg(runBg)(fg(runFg)(runText)));
      runText = "";
    }
    runText += style.text;
    runFg = style.fgColor;
    runBg = style.bgColor;
  }

  if (runText) chunks.push(bg(runBg)(fg(runFg)(runText)));
  return new StyledText(chunks);
}

export function PixelSpriteView(props: { sprite: PixelSprite; dim?: boolean }): ReactNode {
  const dim = props.dim ?? false;
  return (
    <box style={{ flexDirection: "column", width: props.sprite.width }}>
      {props.sprite.cellRows.map((row, index) => (
        <text key={index} content={rowToStyledText(row, dim)} />
      ))}
    </box>
  );
}
