/**
 * Tool Counter Widget — Tool call counts in a widget above the editor
 *
 * Shows a persistent, live-updating widget with per-tool background colors.
 * Format: Tools (N): [Bash 3] [Read 7] [Write 2]
 *
 * Usage: pi -e extensions/tool-counter-widget.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

// Gruvbox Material (medium dark) — bg_visual_* and bg_diff_* accent backgrounds
const palette = [
  [76, 52, 50], // bg_visual_red    #4c3432
  [79, 66, 46], // bg_visual_yellow #4f422e
  [59, 68, 57], // bg_visual_green  #3b4439
  [55, 65, 65], // bg_visual_blue   #374141
  [68, 56, 64], // bg_visual_purple #443840
  [64, 33, 32], // bg_diff_red      #402120
  [52, 56, 27], // bg_diff_green    #34381b
  [14, 54, 62], // bg_diff_blue     #0e363e
];
// Gruvbox Material fg0 (#d4be98) for badge text
const fgRgb = [212, 190, 152];

function bg(rgb: number[], s: string): string {
  return `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m${s}\x1b[49m`;
}

export default function (pi: ExtensionAPI) {
  const counts: Record<string, number> = {};
  const toolColors: Record<string, number[]> = {};
  let total = 0;
  let colorIdx = 0;

  pi.on("tool_execution_end", async (event) => {
    if (!(event.toolName in toolColors)) {
      toolColors[event.toolName] = palette[colorIdx % palette.length];
      colorIdx++;
    }
    counts[event.toolName] = (counts[event.toolName] || 0) + 1;
    total++;
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setWidget("tool-counter", (_tui) => {
      const text = new Text("", 1, 1);

      return {
        render(width: number): string[] {
          const entries = Object.entries(counts);
          const parts = entries.map(([name, count]) => {
            const rgb = toolColors[name];
            return bg(
              rgb,
              `\x1b[38;2;${fgRgb[0]};${fgRgb[1]};${fgRgb[2]}m  ${name} ${count}  \x1b[39m`,
            );
          });
          text.setText(
            `Tools (${total}):` +
              (entries.length > 0 ? " " + parts.join(" ") : ""),
          );
          return text.render(width);
        },
        invalidate() {
          text.invalidate();
        },
      };
    });
  });
}
