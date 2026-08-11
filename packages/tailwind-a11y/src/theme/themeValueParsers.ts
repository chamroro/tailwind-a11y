import { hexToRgb } from "../contrast/luminance.js";

const SPACING_RE = /^-?[\d.]+(rem|px)$/;

export function parseSpacingValue(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = SPACING_RE.exec(value);
  if (!match) return null; // em/%/vw/bare number/function -- skip, don't guess
  const num = parseFloat(value);
  return match[1] === "rem" ? num * 16 : num; // matches spacingScale.ts's 16px-root assumption
}

// Only plain hex-shade objects are accepted (e.g. `brand: { 500: '#3490dc' }`).
// A flat string color (`brand: '#3490dc'`) or a `DEFAULT` key is skipped
// entirely -- there's no class syntax ("bg-brand-DEFAULT" isn't real Tailwind)
// that would ever resolve to it, so partially supporting it would be dead code.
export function parseColorScale(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const shades: Record<string, string> = {};
  for (const [shade, shadeValue] of Object.entries(value)) {
    if (shade === "DEFAULT") continue; // no "bg-brand-DEFAULT" class syntax exists to resolve it
    if (typeof shadeValue !== "string") continue;
    if (hexToRgb(shadeValue) === null) continue; // not a hex value -- skip, don't guess
    shades[shade] = shadeValue;
  }
  return Object.keys(shades).length > 0 ? shades : null;
}
