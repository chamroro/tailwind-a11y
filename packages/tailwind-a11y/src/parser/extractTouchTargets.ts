import * as t from "@babel/types";
import type { NodePath } from "@babel/traverse";
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

function isMeaningfulText(node: t.Node | undefined): boolean {
  // Pure JSX-formatting whitespace (indentation/newlines between elements)
  // doesn't count as text.
  return !!node && t.isJSXText(node) && node.value.trim().length > 0;
}

// WCAG 2.5.8's "Inline" exception: a target inside a sentence or block of
// text is exempt from the minimum size, since its size is constrained by
// surrounding text flow rather than a deliberate layout choice. Checked via
// the element's *immediate* siblings only (not "any text anywhere in the
// parent") — a parent-wide check would exempt every sibling in something
// like `<p>Choose: <button/><button/></p>` just because the first button
// happens to sit next to text, even though the second one doesn't. That's
// the same "shape, not meaning" failure mode as the bg-opacity-50/ring-0
// false negatives documented in CLAUDE.md, just at the sibling level instead
// of the token level.
function isInlineInText(path: NodePath<t.JSXElement>): boolean {
  const parentNode = path.parentPath?.node;
  if (!parentNode || (!t.isJSXElement(parentNode) && !t.isJSXFragment(parentNode))) return false;
  const siblings = parentNode.children;
  const index = siblings.indexOf(path.node);
  if (index === -1) return false;
  return isMeaningfulText(siblings[index - 1]) || isMeaningfulText(siblings[index + 1]);
}

export function extractTouchTargetChecks(
  code: string,
  filePath: string,
  spacing: Record<string, number> = spacingScale
): TouchTargetCheck[] {
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

      const widthPx = spacing[width.value];
      const heightPx = spacing[height.value];
      if (widthPx === undefined || heightPx === undefined) return; // arbitrary/keyword/fraction — skip

      if (isInlineInText(path)) return; // WCAG 2.5.8 inline exception — exempt, not a violation

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

export interface TouchTargetSkip {
  file: string;
  line: number;
  reason: string;
}

// Independent pass surfacing why an interactive element with size-related
// classes produced no check: either only one of w-*/h-* is present, or a
// present value isn't in the default spacing scale (arbitrary, keyword, or
// fraction). Elements with neither w-* nor h-* at all aren't reported —
// that's the overwhelming majority of interactive elements and would be
// pure noise, not a meaningful skip.
export function extractTouchTargetSkips(
  code: string,
  filePath: string,
  spacing: Record<string, number> = spacingScale
): TouchTargetSkip[] {
  const ast = parseJSX(code, filePath);
  if (!ast) return [];

  const skips: TouchTargetSkip[] = [];

  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      if (!isInteractiveElement(opening)) return;

      const className = getStaticClassName(opening.attributes);
      if (!className) return;

      const tokens = className.split(/\s+/).filter(Boolean);
      const width = lastSizeToken(tokens, "w");
      const height = lastSizeToken(tokens, "h");
      if (!width && !height) return; // no size classes at all — not a meaningful skip

      const line = opening.loc?.start.line ?? 0;

      if (!width || !height) {
        const found = width ?? height!;
        const missing = width ? "height" : "width";
        skips.push({ file: filePath, line, reason: `${found.raw} present but no ${missing} utility set — skipped` });
        return;
      }

      const widthPx = spacing[width.value];
      const heightPx = spacing[height.value];
      if (widthPx === undefined || heightPx === undefined) {
        const bad = widthPx === undefined ? width.raw : height.raw;
        skips.push({ file: filePath, line, reason: `${bad} is not in the resolved spacing scale (arbitrary, keyword, or fraction value) — skipped` });
      }
    },
  });

  return skips;
}
