import type { NodePath } from "@babel/traverse";
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
// Exported for reuse in checkFocusIndicator.ts, which needs the exact same
// "does this suffix look like a color value" test to detect shadow-{color}/
// ring-{color} decoys (see that file for why) -- one definition, not a
// second copy that could silently drift out of sync.
export const COLOR_TOKEN =
  /^\[(#[0-9a-fA-F]{3,8})\](\/\d{1,3})?$|^[a-z]+-\d{2,3}(\/\d{1,3})?$|^(white|black|transparent|current|inherit)(\/\d{1,3})?$/;

// opacity-{N} (e.g. bg-opacity-50, text-opacity-50) matches the same
// "word-number" shape as a color token but isn't one — without this
// exclusion it can silently overwrite a real color match via the
// last-token-wins rule below, making a real violation vanish (a false
// negative, the worst failure mode for a linter). linear-{N}/conic-{N}
// (Tailwind v4's bg-linear-45/bg-conic-180 gradient-angle utilities) are
// the same failure mode: bg-linear-45 shares the word-number shape with
// bg-red-500 and would otherwise mask it via last-token-wins.
const NON_COLOR_SCALE_NAMES = new Set(["opacity", "linear", "conic"]);

// One definition, not two hand-mirrored copies (lastColorToken and
// lastPlaceholderColorToken both need this exact test) -- the same "one
// definition, not a second copy that could drift" reasoning already applied
// to COLOR_TOKEN itself.
function isColorScaleToken(rest: string): boolean {
  if (!COLOR_TOKEN.test(rest)) return false;
  const scaleName = /^([a-z]+)-\d/.exec(rest)?.[1];
  return !(scaleName && NON_COLOR_SCALE_NAMES.has(scaleName));
}

export function lastColorToken(className: string, prefix: "text" | "bg"): string | null {
  let found: string | null = null;
  for (const raw of className.split(/\s+/).filter(Boolean)) {
    // Variant-scoped classes (hover:/dark:/md:/...) are skipped entirely,
    // not stripped down to their base utility -- fixed after independent
    // testing found a real false negative: `bg-white dark:bg-gray-900`
    // with `text-gray-300` silently passed, because stripping the `dark:`
    // prefix let it participate in last-token-wins as if it were the real,
    // always-rendered resting-state background, when `dark:bg-gray-900`
    // only ever applies under a completely different condition. Mirrors
    // `extractTouchTargets.ts`'s `lastSizeToken`, which already excludes
    // any variant-scoped size token from resting-state resolution the same
    // way (`if (raw.includes(":")) continue;`) -- this had no equivalent
    // guard for colors.
    if (raw.includes(":")) continue;
    if (!raw.startsWith(`${prefix}-`)) continue;
    const rest = raw.slice(prefix.length + 1);
    if (!isColorScaleToken(rest)) continue;
    found = raw;
  }
  return found;
}

// placeholder:text-* targets the ::placeholder pseudo-element -- a
// genuinely different rendered text than the element's own resting text
// color, so it's checked as an independent candidate, not folded into
// lastColorToken. Deliberately the exact two-segment shape only
// (raw.split(":") === ["placeholder", "text-..."]) -- a nested shape like
// dark:placeholder:text-gray-500 is NOT recognized. This isn't a narrower-
// for-now cut, it's the only choice consistent with how lastColorToken
// already treats every other variant-scoped color candidate in this same
// file: skip outright rather than guess which persistent condition is
// active. Returns the full raw string including the "placeholder:" prefix
// -- checkContrast.ts's resolveColorValue/suggestContrastFix tolerate the
// prefix directly, so every downstream message/skip-reason/suggestion
// already reads correctly with zero further changes.
function lastPlaceholderColorToken(className: string): string | null {
  let found: string | null = null;
  for (const raw of className.split(/\s+/).filter(Boolean)) {
    const segments = raw.split(":");
    if (segments.length !== 2 || segments[0] !== "placeholder") continue;
    const base = segments[1];
    if (!base.startsWith("text-")) continue;
    const rest = base.slice("text-".length);
    if (!isColorScaleToken(rest)) continue;
    found = raw;
  }
  return found;
}

// ::placeholder only exists on <input>/<textarea> in any browser -- a
// placeholder:text-* class on any other tag is not "maybe irrelevant," it
// is dead CSS, guaranteed never to render. Unlike reduced-motion's
// deliberate "not scoped to isInteractiveElement()" choice (a hover-
// animated <div> genuinely animates), tag-scoping here prevents a
// guaranteed false positive rather than narrowing a genuine one. A small
// local set, not a reuse of isInteractiveElement() -- that helper also
// matches button/a/select and any onClick-bearing element, none of which
// can render a placeholder.
const PLACEHOLDER_CAPABLE_TAGS = new Set(["input", "textarea"]);

function isPlaceholderCapable(openingElement: t.JSXOpeningElement): boolean {
  return (
    t.isJSXIdentifier(openingElement.name) && PLACEHOLDER_CAPABLE_TAGS.has(openingElement.name.name)
  );
}

// Resolves an element's background exactly once (self, else immediate JSX
// parent — see extractChecks' own scope note) so both the resting-text and
// placeholder candidates share one bg/bgSource pair rather than each
// re-walking the parent chain independently.
function resolveBg(path: NodePath<t.JSXElement>): { bg: string; source: "self" | "parent" } | null {
  const className = getStaticClassName(path.node.openingElement.attributes);
  const ownBg = className ? lastColorToken(className, "bg") : null;
  if (ownBg) return { bg: ownBg, source: "self" };

  const parentNode = path.parentPath?.node;
  if (parentNode && t.isJSXElement(parentNode)) {
    const parentClassName = getStaticClassName(parentNode.openingElement.attributes);
    const parentBg = parentClassName ? lastColorToken(parentClassName, "bg") : null;
    if (parentBg) return { bg: parentBg, source: "parent" };
  }
  return null;
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
      const placeholderClass = isPlaceholderCapable(path.node.openingElement)
        ? lastPlaceholderColorToken(className)
        : null;
      if (!textClass && !placeholderClass) return;

      const line = path.node.openingElement.loc?.start.line ?? 0;

      // Only the immediate JSX parent is considered — no deeper ancestor
      // walk and no cross-component resolution (see CLAUDE.md scope).
      const bg = resolveBg(path);
      if (!bg) return;

      if (textClass) {
        checks.push({ file: filePath, line, textColorClass: textClass, bgColorClass: bg.bg, bgSource: bg.source });
      }
      if (placeholderClass) {
        checks.push({ file: filePath, line, textColorClass: placeholderClass, bgColorClass: bg.bg, bgSource: bg.source });
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
      const placeholderClass = isPlaceholderCapable(path.node.openingElement)
        ? lastPlaceholderColorToken(className)
        : null;
      if (!textClass && !placeholderClass) return;

      if (resolveBg(path)) return; // extractChecks already covers this case, for either candidate

      const line = path.node.openingElement.loc?.start.line ?? 0;
      const parentNode = path.parentPath?.node;
      const parentTag =
        parentNode && t.isJSXElement(parentNode) && t.isJSXIdentifier(parentNode.openingElement.name)
          ? parentNode.openingElement.name.name
          : null;

      const reportSkip = (candidateClass: string) => {
        if (parentTag && /^[A-Z]/.test(parentTag)) {
          skips.push({
            file: filePath,
            line,
            reason: `${candidateClass} — background may be set inside <${parentTag}>, which this tool doesn't inspect across component boundaries`,
          });
          return;
        }
        skips.push({
          file: filePath,
          line,
          reason: `${candidateClass} — no background utility found on this element or its immediate parent`,
        });
      };

      if (textClass) reportSkip(textClass);
      if (placeholderClass) reportSkip(placeholderClass);
    },
  });

  return skips;
}
