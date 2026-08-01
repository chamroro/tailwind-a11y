import { contrastRatio, hexToRgb, meetsWCAG, requiredRatio } from "../contrast/luminance.js";
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
  const match = /^(?:text|bg)-(.+)$/.exec(utilityClass);
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

export function checkContrast(checks: ContrastCheck[], palette: Palette = defaultPalette): ContrastViolation[] {
  const violations: ContrastViolation[] = [];

  for (const check of checks) {
    const textHex = resolveColorValue(check.textColorClass, palette);
    const bgHex = resolveColorValue(check.bgColorClass, palette);
    if (!textHex || !bgHex) continue;

    const textRgb = hexToRgb(textHex);
    const bgRgb = hexToRgb(bgHex);
    if (!textRgb || !bgRgb) continue;

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

// Only the text shade moves — bg stays fixed, since text color is the more
// commonly adjustable side in practice. Candidates come from the palette's
// actual keys (not an assumed 50..950 enumeration), sorted nearest-first by
// numeric distance from the original shade; ties favor the higher/darker
// shade, since real failures here are overwhelmingly light-on-light and
// darker is the fix a human reaches for. The original shade can never win:
// it's in this same candidate list at distance 0, and this recomputes the
// identical unrounded ratio comparison that just failed.
export function suggestContrastFix(
  textClass: string,
  bgClass: string,
  required: number,
  palette: Palette = defaultPalette
): ContrastFix | null {
  const match = TEXT_SCALE_SHADE_RE.exec(textClass);
  if (!match) return null; // text-white, text-[#eee], text-gray-400/50 — no suggestion

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

  for (const candidate of candidates) {
    const rgb = hexToRgb(shades[String(candidate)]);
    if (!rgb) continue;
    const ratio = contrastRatio(rgb, bgRgb);
    if (ratio >= required) return { textClass: `text-${scale}-${candidate}`, ratio };
  }

  return null;
}

export interface ContrastValueSkip {
  file: string;
  line: number;
  reason: string;
}

// A candidate that extractChecks *did* find a background for, but whose
// text or bg utility didn't resolve to a known value (custom theme color,
// non-hex arbitrary value, opacity shorthand) — surfaced separately from
// extractContrastSkips' component-boundary case, since this one already has
// a full text/bg pair and only failed at value resolution.
export function checkContrastValueSkips(
  checks: ContrastCheck[],
  palette: Palette = defaultPalette
): ContrastValueSkip[] {
  const skips: ContrastValueSkip[] = [];

  for (const check of checks) {
    const textHex = resolveColorValue(check.textColorClass, palette);
    const bgHex = resolveColorValue(check.bgColorClass, palette);
    if (textHex && bgHex) continue;

    const unresolved = !textHex ? check.textColorClass : check.bgColorClass;
    skips.push({
      file: check.file,
      line: check.line,
      reason: `${unresolved} is not a recognized color (custom theme color or unsupported arbitrary value) — skipped`,
    });
  }

  return skips;
}
