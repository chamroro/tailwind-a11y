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
}

// WCAG 2.5.8 Target Size (Minimum), Level AA: interactive targets must be
// at least 24x24 CSS pixels. "Minimum" is inclusive, so exactly 24x24 passes.
const MIN_TARGET_PX = 24;

export function checkTouchTargets(checks: TouchTargetCheck[]): TouchTargetViolation[] {
  return checks
    .filter((c) => c.widthPx < MIN_TARGET_PX || c.heightPx < MIN_TARGET_PX)
    .map((c) => ({ type: "touch-target" as const, ...c }));
}
