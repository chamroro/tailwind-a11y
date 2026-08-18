import type { TouchTargetCheck } from "../parser/extractTouchTargets.js";

export interface TouchTargetViolation {
  type: "touch-target";
  file: string;
  line: number;
  tagName: string;
  widthClass: string;
  heightClass: string;
  widthPx: number;
  heightPx: number;
  required: number;
  // Unlike ContrastViolation's level (always "AA" -- no AAA contrast check
  // exists yet), this is a real union: strict mode genuinely switches which
  // WCAG success criterion is being enforced, not just a stricter number
  // under the same one.
  level: "AA" | "AAA";
}

// WCAG 2.5.8 Target Size (Minimum), Level AA: interactive targets must be
// at least 24x24 CSS pixels. "Minimum" is inclusive, so exactly 24x24 passes.
const MIN_TARGET_PX = 24;

// WCAG 2.5.5 Target Size (Enhanced), Level AAA: 44x44 CSS pixels -- opt-in
// via `strict`, not the default. Same "target in a sentence/text block"
// exemption as 2.5.8 (verified against the W3C Understanding doc), so
// extractTouchTargets.ts's isInlineInText() exemption logic applies
// unchanged to both thresholds -- this file only changes which number is
// compared against, not how targets are found or exempted.
const MIN_TARGET_PX_STRICT = 44;

export function checkTouchTargets(checks: TouchTargetCheck[], strict = false): TouchTargetViolation[] {
  const required = strict ? MIN_TARGET_PX_STRICT : MIN_TARGET_PX;
  const level = strict ? "AAA" : "AA";
  return checks
    .filter((c) => c.widthPx < required || c.heightPx < required)
    .map((c) => ({ type: "touch-target" as const, ...c, required, level }));
}
