// @vitest-environment jsdom
/**
 * Not an assertion test: renders the dial to a standalone SVG so the shape can
 * be eyeballed. Skipped unless RENDER_PREVIEW points at an output directory.
 */
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";

import { WavelengthDial } from "@/components/dial/WavelengthDial";

// Tailwind classes aren't present in a bare SVG file, so map the ones used.
const STYLE = `
.fill-stone-700{fill:#44403c}.fill-stone-800{fill:#292524}.fill-stone-900{fill:#1c1917}
.fill-stone-600{fill:#57534e}.stroke-stone-400{stroke:#a8a29e}.stroke-stone-600{stroke:#57534e}
.stroke-stone-700{stroke:#44403c}
.fill-rose-500{fill:#f43f5e}.fill-white{fill:#fff}
.fill-slate-700{fill:#334155}.stroke-slate-900{stroke:#0f172a}
.stroke-red-600{stroke:#dc2626}.fill-red-500{fill:#ef4444}
.fill-sky-200{fill:#bae6fd}.fill-amber-200{fill:#fde68a}
text{font-family:ui-sans-serif,system-ui,sans-serif}
.font-bold{font-weight:700}.font-semibold{font-weight:600}
`;

const OUT = process.env.RENDER_PREVIEW;

describe.skipIf(!OUT)("dial preview", () => {
  it.each([
    ["closed", false, null],
    ["psychic", true, 0.68],
  ] as const)("renders %s", (name, open, target) => {
    const markup = renderToStaticMarkup(
      <WavelengthDial
        leftLabel="Underrated"
        rightLabel="Overrated"
        needlePosition={0.38}
        targetCenter={target}
        screenOpen={open}
        interactive={false}
      />,
    );
    const svg = markup
      .replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="540" style="background:#0c0a09"')
      .replace("</defs>", `</defs><style>${STYLE}</style>`)
      // Opacity utilities need explicit handling in a bare file.
      .replaceAll('class="fill-amber-200/85"', 'fill="#fde68a" fill-opacity="0.85"')
      .replaceAll('class="fill-orange-400/90"', 'fill="#fb923c" fill-opacity="0.9"');
    writeFileSync(`${OUT}/dial-${name}.svg`, svg);
  });
});
