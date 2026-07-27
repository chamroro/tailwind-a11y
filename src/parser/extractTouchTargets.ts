import * as t from "@babel/types";
import { getStaticClassName, parseJSX, traverse } from "./babelInterop.js";
import { isInteractiveElement } from "./isInteractiveElement.js";
import { spacingScale } from "../theme/spacingScale.js";

export interface TouchTargetCheck {
  file: string;
  line: number;
  tagName: string;
  widthClass: string;
  heightClass: string;
  widthPx: number;
  heightPx: number;
}

interface SizeToken {
  raw: string;
  value: string;
}

// Only unprefixed w-*/h-* tokens count — a variant-scoped size like
// hover:w-24 does not describe the resting-state box, so it must not be
// allowed to overwrite a real base match via "last token wins" (the same
// failure mode as bg-opacity-50 masking bg-white in the contrast checker).
function lastSizeToken(tokens: string[], prefix: "w" | "h"): SizeToken | null {
  let found: SizeToken | null = null;
  for (const raw of tokens) {
    if (raw.includes(":")) continue;
    if (!raw.startsWith(`${prefix}-`)) continue;
    found = { raw, value: raw.slice(prefix.length + 1) };
  }
  return found;
}

export function extractTouchTargetChecks(code: string, filePath: string): TouchTargetCheck[] {
  const ast = parseJSX(code, filePath);
  if (!ast) return [];

  const checks: TouchTargetCheck[] = [];

  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      if (!isInteractiveElement(opening)) return;

      const className = getStaticClassName(opening.attributes);
      if (!className) return;

      const tokens = className.split(/\s+/).filter(Boolean);
      const width = lastSizeToken(tokens, "w");
      const height = lastSizeToken(tokens, "h");
      if (!width || !height) return; // either dimension missing/dynamic — skip, don't guess

      const widthPx = spacingScale[width.value];
      const heightPx = spacingScale[height.value];
      if (widthPx === undefined || heightPx === undefined) return; // arbitrary/keyword/fraction — skip

      checks.push({
        file: filePath,
        line: opening.loc?.start.line ?? 0,
        tagName: t.isJSXIdentifier(opening.name) ? opening.name.name : "onClick-element",
        widthClass: width.raw,
        heightClass: height.raw,
        widthPx,
        heightPx,
      });
    },
  });

  return checks;
}
