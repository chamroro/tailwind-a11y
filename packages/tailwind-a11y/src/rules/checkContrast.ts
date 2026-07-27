import { contrastRatio, hexToRgb, meetsWCAG, requiredRatio } from "../contrast/luminance.js";
import { defaultPalette, semanticColors } from "../theme/defaultPalette.js";
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
}

export function resolveColorValue(utilityClass: string): string | null {
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
  return defaultPalette[scale]?.[shade] ?? null; // unknown/custom color — skip
}

export function checkContrast(checks: ContrastCheck[]): ContrastViolation[] {
  const violations: ContrastViolation[] = [];

  for (const check of checks) {
    const textHex = resolveColorValue(check.textColorClass);
    const bgHex = resolveColorValue(check.bgColorClass);
    if (!textHex || !bgHex) continue;

    const textRgb = hexToRgb(textHex);
    const bgRgb = hexToRgb(bgHex);
    if (!textRgb || !bgRgb) continue;

    const ratio = contrastRatio(textRgb, bgRgb);
    const required = requiredRatio("AA", false); // v1: large-text detection deferred

    if (!meetsWCAG(ratio, "AA", false)) {
      violations.push({
        type: "contrast",
        file: check.file,
        line: check.line,
        textClass: check.textColorClass,
        bgClass: check.bgColorClass,
        ratio,
        required,
        level: "AA",
      });
    }
  }

  return violations;
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
export function checkContrastValueSkips(checks: ContrastCheck[]): ContrastValueSkip[] {
  const skips: ContrastValueSkip[] = [];

  for (const check of checks) {
    const textHex = resolveColorValue(check.textColorClass);
    const bgHex = resolveColorValue(check.bgColorClass);
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
