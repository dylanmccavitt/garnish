# Monogrid theme findings

## Final palette

| Token | Hex | Use |
| --- | --- | --- |
| `bg` | `#0D0D0E` | Near-black neutral application background. |
| `panel` | `#151517` | Slightly lifted panel fill; visible without feeling tinted. |
| `border` | `#343438` | Crisp neutral gray grid lines and modal frames. |
| `primary` | `#F5F5F0` | Bright off-white emphasis; intentionally not a hue. Legacy `TUI_ORANGE` now resolves here. |
| `primaryDim` | `#AFAFB5` | Mid-gray active/support emphasis. |
| `accent` | `#7F95B2` | The only restrained chrome hue: muted steel-blue for active/player/approval states. |
| `dim` | `#8A8A8F` | Muted metadata gray. |
| `text` | `#ECECEA` | Main off-white text. |
| `red` | `#C98181` | Muted semantic danger/block/error. |
| `amber` | `#C9AD7A` | Muted sand warning/risky approval. |

Contrast rationale: the chrome is deliberately monochrome first. `text`/`primary` sit far above `bg` and `panel` for terminal legibility; `dim` remains readable metadata instead of disappearing; `border` is a visible grid edge without glowing. The only non-semantic interaction color is `accent`, and warning/error color is reserved for approval risk and failures. Pixel sprites now carry the visual color pop.

## PixelSpriteView rendering

`proto/tui/pixel.tsx` renders generated `cellRows` only; it never places raw ANSI inside OpenTUI text. Each terminal cell is a `▀` half-block where `fg` is the top pixel and `bg` is the bottom pixel. Empty cells render as a background-colored space. When only the lower pixel exists, the top foreground is set to the monogrid background so the lower half remains visible.

The implementation uses OpenTUI's styled-text chunk API (`StyledText`, `fg`, `bg`) and batches adjacent cells that share foreground/background into a single chunk per run. That avoids one `<text>` per pixel while staying simple enough for the prototype. Sprites are currently at most ~20 columns by ~7 rows, so even a per-cell fallback would be acceptable, but chunk runs keep the renderer comfortably cheap and reduce React child count.

`dim` mode maps sprite colors toward neutral gray rather than using raw terminal dim attributes, preserving pixel silhouettes while reducing intensity.

## LOO-166 / LOO-168 / LOO-174 style-guide input

- LOO-166: remove the retro green/purple CRT identity from shared TUI chrome. Keep the dashboard neutral, gridded, and high-contrast; no phosphor, purple glow, or shaded block ornaments.
- LOO-168: make game state readable before decorative. Quest/unlock/file moments now use text-colored glyphs; approvals use the single steel-blue accent; blocked/errors use muted red. Transcript rows read as an activity feed with aligned labels.
- LOO-174: use baked Codex pixel sprites for character/color personality. Text-mode callers receive the generated ANSI rows through `mascot()`, while OpenTUI callers should render sprites through `PixelSpriteView` so raw ANSI never enters text-mode surfaces.
