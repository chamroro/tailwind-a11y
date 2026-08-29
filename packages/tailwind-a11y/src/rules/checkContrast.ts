import { applyAlpha, contrastRatio, hexToRgb, meetsWCAG, requiredRatio } from "../contrast/luminance.js";
import type { RGB } from "../contrast/luminance.js";
import { defaultPalette, semanticColors } from "../theme/defaultPalette.js";
import type { Palette } from "../theme/defaultPalette.js";
import type { ContrastCheck } from "../parser/extractClasses.js";

export interface ContrastViolation {
  type: "contrast";
  file: string;
  line: number;
  textClass: string;
  bgClass: string;
  ratio: number;
  required: number;
  level: "AA";
  suggestion?: string;
  suggestedRatio?: number;
}

export function resolveColorValue(utilityClass: string, palette: Palette = defaultPalette): string | null {
  // outline/ring are here for checkFocusIndicator.ts's non-text-contrast
  // check (WCAG 1.4.11/2.4.13) -- same palette/arbitrary-hex/semantic-color
  // resolution as text/bg, just a different utility prefix.
  const match = /^(?:text|bg|outline|ring)-(.+)$/.exec(utilityClass);
  if (!match) return null;
  const token = match[1];

  const arbitrary = /^\[(#[0-9a-fA-F]{3,8})\]$/.exec(token);
  if (arbitrary) return arbitrary[1];
  if (token.startsWith("[")) return null; // non-hex arbitrary (url()/var()/rgb()) — skip
  if (token.includes("/")) return null; // opacity shorthand — skip rather than approximate

  if (token in semanticColors) return semanticColors[token];

  const [scale, shade] = token.split("-");
  if (!scale || !shade) return null;
  return palette[scale]?.[shade] ?? null; // unknown/custom color — skip
}

// Splits a trailing Tailwind opacity modifier off a color utility class
// (e.g. "text-gray-400/50" -> { base: "text-gray-400", alpha: 0.5 }). No
// modifier -> alpha 1. Out-of-range (>100) is clamped rather than rejected --
// real browsers clamp out-of-range CSS alpha to the nearest valid bound, so
// "/150" genuinely renders identically to "/100"; silently skipping it
// instead would hide a real violation behind what's essentially a typo. A
// non-digit or malformed suffix falls through as { base: <the whole original
// string>, alpha: 1 } -- base still contains the "/", so resolveColorValue's
// existing guard rejects it downstream; this never needs to return null.
function splitOpacityModifier(utilityClass: string): { base: string; alpha: number } {
  const match = /^(.+)\/(\d{1,3})$/.exec(utilityClass);
  if (!match) return { base: utilityClass, alpha: 1 };
  const pct = Math.min(100, Math.max(0, Number(match[2])));
  return { base: match[1], alpha: pct / 100 };
}

// Resolves a text-* class (with or without an opacity modifier) to the
// effective color it actually renders as, composited against the already-
// resolved (fully opaque) background. Only the text side supports opacity --
// see resolveColorValue's own unconditional "/" rejection for why the
// background side doesn't: compositing a semi-transparent background
// correctly requires knowing what's rendered *behind* it, which is out of
// scope the same way walking further up the ancestor chain is.
function resolveTextColorWithOpacity(utilityClass: string, bgRgb: RGB, palette: Palette): RGB | null {
  const { base, alpha } = splitOpacityModifier(utilityClass);
  if (alpha === 0) return null; // fully transparent -- equivalent to text-transparent, nothing to check
  const hex = resolveColorValue(base, palette);
  const rgb = hex ? hexToRgb(hex) : null;
  if (!rgb) return null;
  return alpha < 1 ? applyAlpha(rgb, alpha, bgRgb) : rgb;
}

export function checkContrast(checks: ContrastCheck[], palette: Palette = defaultPalette): ContrastViolation[] {
  const violations: ContrastViolation[] = [];

  for (const check of checks) {
    const bgHex = resolveColorValue(check.bgColorClass, palette);
    if (!bgHex) continue;
    const bgRgb = hexToRgb(bgHex);
    if (!bgRgb) continue;

    const textRgb = resolveTextColorWithOpacity(check.textColorClass, bgRgb, palette);
    if (!textRgb) continue;

    const ratio = contrastRatio(textRgb, bgRgb);
    const required = requiredRatio("AA", false); // v1: large-text detection deferred

    if (!meetsWCAG(ratio, "AA", false)) {
      const fix = suggestContrastFix(check.textColorClass, check.bgColorClass, required, palette);
      violations.push({
        type: "contrast",
        file: check.file,
        line: check.line,
        textClass: check.textColorClass,
        bgClass: check.bgColorClass,
        ratio,
        required,
        level: "AA",
        ...(fix && { suggestion: fix.textClass, suggestedRatio: fix.ratio }),
      });
    }
  }

  return violations;
}

export interface ContrastFix {
  textClass: string;
  ratio: number;
}

const TEXT_SCALE_SHADE_RE = /^text-([a-z]+)-(\d+)$/;

// Only the text shade moves — bg and any opacity modifier on the text class
// stay fixed, since text color is the more commonly adjustable side in
// practice. Candidates come from the palette's actual keys (not an assumed
// 50..950 enumeration), sorted nearest-first by numeric distance from the
// original shade; ties favor the higher/darker shade, since real failures
// here are overwhelmingly light-on-light and darker is the fix a human
// reaches for. The original shade can never win: it's in this same
// candidate list at distance 0, and this recomputes the identical unrounded
// ratio comparison that just failed.
export function suggestContrastFix(
  textClass: string,
  bgClass: string,
  required: number,
  palette: Palette = defaultPalette
): ContrastFix | null {
  const { base, alpha } = splitOpacityModifier(textClass);
  if (alpha === 0) return null; // no shade change fixes total transparency

  const match = TEXT_SCALE_SHADE_RE.exec(base);
  if (!match) return null; // text-white, text-[#eee] — no suggestion

  const [, scale, shade] = match;
  const shades = palette[scale];
  if (!shades?.[shade]) return null; // custom scale, or a decoy like text-opacity-50

  const bgHex = resolveColorValue(bgClass, palette);
  const bgRgb = bgHex ? hexToRgb(bgHex) : null;
  if (!bgRgb) return null;

  const original = Number(shade);
  const candidates = Object.keys(shades)
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
    .sort((a, b) => Math.abs(a - original) - Math.abs(b - original) || b - a);

  // Only the shade searches candidates -- the original opacity is held
  // fixed, exactly like bg is already held fixed.
  for (const candidate of candidates) {
    const rgb = hexToRgb(shades[String(candidate)]);
    if (!rgb) continue;
    const effectiveRgb = alpha < 1 ? applyAlpha(rgb, alpha, bgRgb) : rgb;
    const ratio = contrastRatio(effectiveRgb, bgRgb);
    if (ratio >= required) {
      const suggestedClass = alpha < 1 ? `text-${scale}-${candidate}/${Math.round(alpha * 100)}` : `text-${scale}-${candidate}`;
      return { textClass: suggestedClass, ratio };
    }
  }

  return null;
}

export interface ContrastValueSkip {
  file: string;
  line: number;
  reason: string;
}

// resolveColorValue() bails out on any bg-side opacity modifier before ever
// checking whether the underlying color is real (background-side opacity
// compositing is out of scope -- see CLAUDE.md -- since it depends on
// knowing what's rendered behind an already-semi-transparent background).
// Caught in independent adversarial testing: this made checkContrastValueSkips
// report `bg-gray-800/50 is not a recognized color`, even though gray-800
// is a perfectly recognized default-palette color -- a developer reading
// that message would reasonably (and pointlessly) try adding a theme entry
// for it. Distinguishes the two cases by re-resolving the color with the
// opacity suffix stripped off: if that succeeds, the real reason is the
// out-of-scope opacity, not an unrecognized color.
function bgSkipReason(bgColorClass: string, palette: Palette): string {
  const { base, alpha } = splitOpacityModifier(bgColorClass);
  if (alpha < 1 && resolveColorValue(base, palette) !== null) {
    return `${bgColorClass} is a recognized color, but background-side opacity isn't resolved (compositing it correctly requires knowing what's rendered behind it) — skipped`;
  }
  return `${bgColorClass} is not a recognized color (custom theme color or unsupported arbitrary value) — skipped`;
}

// A candidate that extractChecks *did* find a background for, but whose
// text or bg utility didn't resolve to a known value (custom theme color,
// non-hex arbitrary value, background-side opacity shorthand) — surfaced
// separately from extractContrastSkips' component-boundary case, since this
// one already has a full text/bg pair and only failed at value resolution.
//
// Resolves bg first, same order as checkContrast, so a bg-side failure and a
// text-side failure are attributed to the correct class -- since text
// resolution now depends on a known bg to composite against, resolving both
// independently (as before) would make every bg failure also look like a
// text failure. This does mean that when *both* sides are unresolvable for
// unrelated reasons, bg is now named first (previously text always was) --
// a deliberate, tested change, not an accidental side effect of reordering.
export function checkContrastValueSkips(
  checks: ContrastCheck[],
  palette: Palette = defaultPalette
): ContrastValueSkip[] {
  const skips: ContrastValueSkip[] = [];

  for (const check of checks) {
    const bgHex = resolveColorValue(check.bgColorClass, palette);
    const bgRgb = bgHex ? hexToRgb(bgHex) : null;
    if (!bgRgb) {
      skips.push({ file: check.file, line: check.line, reason: bgSkipReason(check.bgColorClass, palette) });
      continue;
    }

    const { alpha } = splitOpacityModifier(check.textColorClass);
    if (alpha === 0) {
      skips.push({
        file: check.file,
        line: check.line,
        reason: `${check.textColorClass} is fully transparent (opacity 0) — nothing rendered to check`,
      });
      continue;
    }

    const textRgb = resolveTextColorWithOpacity(check.textColorClass, bgRgb, palette);
    if (!textRgb) {
      skips.push({
        file: check.file,
        line: check.line,
        reason: `${check.textColorClass} is not a recognized color (custom theme color or unsupported arbitrary value) — skipped`,
      });
    }
  }

  return skips;
}
