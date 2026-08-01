import * as t from "@babel/types";
import { getStaticClassName, parseJSX, traverse } from "./babelInterop.js";

export interface ContrastCheck {
  file: string;
  line: number;
  textColorClass: string;
  bgColorClass: string;
  bgSource: "self" | "parent";
}

// Positive shape filter for "does this look like a color utility", not a
// blocklist — Tailwind heavily overloads the text-*/bg-* prefix (text-lg,
// bg-cover, bg-gradient-to-r, ...) and an exclude-list would be fragile
// across versions. Every alternative allows an optional trailing opacity
// modifier (/NN) so text-white/40, text-[#eee]/40, and text-gray-400/40 are
// all extracted with the suffix intact -- text-white/black-with-opacity is
// an extremely common real idiom, more so than the named-scale case, and
// dropping it here would make the contrast checker's opacity support (see
// rules/checkContrast.ts) silently inapplicable to the most common case.
const COLOR_TOKEN =
  /^\[(#[0-9a-fA-F]{3,8})\](\/\d{1,3})?$|^[a-z]+-\d{2,3}(\/\d{1,3})?$|^(white|black|transparent|current|inherit)(\/\d{1,3})?$/;

// opacity-{N} (e.g. bg-opacity-50, text-opacity-50) matches the same
// "word-number" shape as a color token but isn't one — without this
// exclusion it can silently overwrite a real color match via the
// last-token-wins rule below, making a real violation vanish (a false
// negative, the worst failure mode for a linter).
const NON_COLOR_SCALE_NAMES = new Set(["opacity"]);

export function lastColorToken(className: string, prefix: "text" | "bg"): string | null {
  let found: string | null = null;
  for (const raw of className.split(/\s+/).filter(Boolean)) {
    const base = raw.slice(raw.lastIndexOf(":") + 1); // strip hover:/dark:/md: variants
    if (!base.startsWith(`${prefix}-`)) continue;
    const rest = base.slice(prefix.length + 1);
    if (!COLOR_TOKEN.test(rest)) continue;
    const scaleName = /^([a-z]+)-\d/.exec(rest)?.[1];
    if (scaleName && NON_COLOR_SCALE_NAMES.has(scaleName)) continue;
    found = base;
  }
  return found;
}

export function extractChecks(code: string, filePath: string): ContrastCheck[] {
  const ast = parseJSX(code, filePath);
  if (!ast) return [];

  const checks: ContrastCheck[] = [];

  traverse(ast, {
    JSXElement(path) {
      const className = getStaticClassName(path.node.openingElement.attributes);
      if (!className) return;

      const textClass = lastColorToken(className, "text");
      if (!textClass) return;

      const line = path.node.openingElement.loc?.start.line ?? 0;

      const ownBg = lastColorToken(className, "bg");
      if (ownBg) {
        checks.push({ file: filePath, line, textColorClass: textClass, bgColorClass: ownBg, bgSource: "self" });
        return;
      }

      // Only the immediate JSX parent is considered — no deeper ancestor
      // walk and no cross-component resolution (see CLAUDE.md scope).
      const parentNode = path.parentPath?.node;
      if (parentNode && t.isJSXElement(parentNode)) {
        const parentClassName = getStaticClassName(parentNode.openingElement.attributes);
        const parentBg = parentClassName ? lastColorToken(parentClassName, "bg") : null;
        if (parentBg) {
          checks.push({ file: filePath, line, textColorClass: textClass, bgColorClass: parentBg, bgSource: "parent" });
        }
      }
    },
  });

  return checks;
}

export interface ContrastSkip {
  file: string;
  line: number;
  reason: string;
}

// Independent pass (not merged into extractChecks) purely to surface why a
// text color candidate produced no check — most usefully, the component-
// boundary case: <Card><p className="text-gray-400">...</Card> where Card
// sets its background internally, in a file this tool never opens. This is
// a real, common miss (see CLAUDE.md's v1 scope), so it's made visible
// rather than silently invisible, without attempting to actually resolve it.
export function extractContrastSkips(code: string, filePath: string): ContrastSkip[] {
  const ast = parseJSX(code, filePath);
  if (!ast) return [];

  const skips: ContrastSkip[] = [];

  traverse(ast, {
    JSXElement(path) {
      const className = getStaticClassName(path.node.openingElement.attributes);
      if (!className) return;

      const textClass = lastColorToken(className, "text");
      if (!textClass) return;

      const ownBg = lastColorToken(className, "bg");
      if (ownBg) return; // extractChecks already covers this case

      const line = path.node.openingElement.loc?.start.line ?? 0;
      const parentNode = path.parentPath?.node;

      if (parentNode && t.isJSXElement(parentNode)) {
        const parentClassName = getStaticClassName(parentNode.openingElement.attributes);
        const parentBg = parentClassName ? lastColorToken(parentClassName, "bg") : null;
        if (parentBg) return; // extractChecks already covers this case

        const parentTag = t.isJSXIdentifier(parentNode.openingElement.name)
          ? parentNode.openingElement.name.name
          : null;
        if (parentTag && /^[A-Z]/.test(parentTag)) {
          skips.push({
            file: filePath,
            line,
            reason: `${textClass} — background may be set inside <${parentTag}>, which this tool doesn't inspect across component boundaries`,
          });
          return;
        }
      }

      skips.push({
        file: filePath,
        line,
        reason: `${textClass} — no background utility found on this element or its immediate parent`,
      });
    },
  });

  return skips;
}
