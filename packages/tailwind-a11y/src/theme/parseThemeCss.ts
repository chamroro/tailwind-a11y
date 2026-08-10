import { parseColorScale, parseSpacingValue } from "./themeValueParsers.js";
import type { RawCustomTheme } from "./loadCustomTheme.js";
import type { Palette } from "./defaultPalette.js";

// Run BEFORE comment-stripping/block-extraction so quoted string content
// (e.g. a `content: "@theme { --color-brand-500: #3490dc; }"` value) can
// never be mistaken for a real @theme block or accidentally throw off brace
// counting -- without this, any valid CSS file containing that substring
// for unrelated reasons (docs/marketing copy showcasing Tailwind v4 syntax,
// for instance) would silently inject spurious palette/spacing entries.
// Replaces each matched string (quotes included) with same-length spaces,
// so it can't itself contain unmasked quotes/braces/`@theme` text, while
// keeping offsets stable. An unterminated string (malformed CSS) just
// doesn't match and is left as-is -- fail safe, don't guess.
function maskStringLiterals(css: string): string {
  return css.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => " ".repeat(m.length));
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// Matches `@theme {`, `@theme inline {`, `@theme static {`, and any other
// modifier keyword Tailwind might add between `@theme` and the opening
// brace -- the declaration syntax inside is identical regardless of
// modifier, so no need to enumerate them. Brace-depth-counted (not a naive
// first-`}` match) so an accidental nested `{` in a value can't truncate the
// block early.
//
// An unclosed `@theme{` (malformed CSS -- missing a `}` somewhere) aborts
// extraction for the rest of the file, not just that one block: brace
// counting has no way to tell "a later, well-formed @theme block" apart
// from "more content nested inside the still-open first block," so any
// `{`/`}` pairs after the missing close (including a second, otherwise-valid
// @theme block) get consumed as if they belonged to the first. The safe,
// honest result is {} for the whole file rather than a guess at which
// blocks were "real" -- same "skip, don't guess" precedent as everywhere
// else in this parser, just at file granularity instead of block
// granularity when recovery isn't possible.
function extractThemeBlocks(css: string): string[] {
  const blocks: string[] = [];
  const OPEN_RE = /@theme\b[^{]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = OPEN_RE.exec(css))) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    if (depth !== 0) break;
    blocks.push(css.slice(start, i - 1));
    OPEN_RE.lastIndex = i;
  }
  return blocks;
}

// Split on `;` rather than a single greedy declaration regex, so a missing
// trailing semicolon before `}` (valid CSS) doesn't drop the last
// declaration.
function extractDeclarations(block: string): Array<[string, string]> {
  const decls: Array<[string, string]> = [];
  for (const raw of block.split(";")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const prop = trimmed.slice(0, colon).trim();
    if (!prop.startsWith("--")) continue;
    decls.push([prop, trimmed.slice(colon + 1).trim()]);
  }
  return decls;
}

// Greedy .+ anchored on the *last* -\d+, so multi-hyphen scale names
// (--color-hot-pink-500) resolve to scale "hot-pink", shade "500".
const COLOR_PROP_RE = /^--color-(.+)-(\d+)$/;
const SPACING_PROP_RE = /^--spacing-([\w-]+)$/;

// Reads Tailwind v4's CSS-first `@theme { ... }` config -- extracts only
// --color-{name}-{shade} and --spacing-{token} custom properties, running
// each value through the exact same hex/rem-px acceptance rules as the JS
// tailwind.config.js path (parseColorScale/parseSpacingValue from
// themeValueParsers.ts), so no validation logic is duplicated between the
// two config formats. A bare `--color-brand: #3490dc` (no shade suffix) is
// skipped -- same "no class syntax to resolve it to" reasoning as the JS
// path's flat-string-color skip. A bare `--spacing: 0.25rem` (Tailwind v4's
// global spacing *multiplier*, which scales all arbitrary spacing
// utilities) is also skipped -- spacingScale.ts is a static named-token to
// px map, not a multiplier system; supporting the multiplier correctly
// would mean reimplementing derived-value math, a different feature.
// `@import`ed files are never followed -- only @theme blocks physically
// present in the given CSS text are read.
//
// Never throws and never returns null -- unlike loadCustomTheme's
// require()-based loading, this is tolerant scanning, not execution, so
// there's no "syntax error" concept here. Worst case (no @theme block, or
// nothing recognized inside one) returns {}, the same "loaded fine but
// nothing to extend" contract loadCustomTheme uses.
export function parseThemeCss(cssText: string): RawCustomTheme {
  const colorBuckets: Record<string, Record<string, string>> = {};
  const spacingRaw: Record<string, string> = {};

  for (const block of extractThemeBlocks(stripComments(maskStringLiterals(cssText)))) {
    for (const [prop, value] of extractDeclarations(block)) {
      const colorMatch = COLOR_PROP_RE.exec(prop);
      if (colorMatch) {
        const [, scale, shade] = colorMatch;
        (colorBuckets[scale] ??= {})[shade] = value;
        continue;
      }
      const spacingMatch = SPACING_PROP_RE.exec(prop);
      if (spacingMatch) spacingRaw[spacingMatch[1]] = value;
    }
  }

  const result: RawCustomTheme = {};

  const colors: Palette = {};
  for (const [scale, shades] of Object.entries(colorBuckets)) {
    const parsed = parseColorScale(shades);
    if (parsed) colors[scale] = parsed;
  }
  if (Object.keys(colors).length > 0) result.colors = colors;

  const spacing: Record<string, number> = {};
  for (const [token, value] of Object.entries(spacingRaw)) {
    const px = parseSpacingValue(value);
    if (px !== null) spacing[token] = px;
  }
  if (Object.keys(spacing).length > 0) result.spacing = spacing;

  return result;
}
