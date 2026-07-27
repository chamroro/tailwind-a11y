import type { FocusIndicatorCheck } from "../parser/extractFocusIndicators.js";

export interface FocusIndicatorViolation {
  type: "focus-indicator";
  file: string;
  line: number;
  tagName: string;
  removalClass: string;
}

const REMOVAL_BASE = "outline-none";

// Utilities that match the "replacement" shape but are semantically no-ops —
// the same failure mode as bg-opacity-50 masking a real color match: a
// same-prefix decoy that would silently hide a real violation if we only
// checked the prefix.
const DEGENERATE_BASES = new Set(["outline-none", "ring-0", "border-0", "shadow-none", "bg-transparent"]);

// Modifier-only utilities (opacity/offset/inset) don't set a concrete value
// on their own — e.g. bg-opacity-50 with no bg-* color, or ring-offset-4
// with no ring-* width, renders nothing visible by itself. Same failure
// mode as DEGENERATE_BASES above, but suffix-shaped rather than a fixed
// set (opacity/offset take arbitrary numeric values), so matched with a
// pattern instead of enumerated.
const MODIFIER_ONLY = /^(bg|border|ring)-opacity-\d{1,3}$|^(ring|outline)-offset-\d{1,3}$|^ring-inset$/;

function baseUtility(raw: string): string {
  return raw.slice(raw.lastIndexOf(":") + 1);
}

function isReplacement(raw: string): boolean {
  const base = baseUtility(raw);
  if (DEGENERATE_BASES.has(base) || MODIFIER_ONLY.test(base)) return false;
  return /^(ring|border|shadow|bg|outline)(-|$)/.test(base);
}

export function checkFocusIndicators(checks: FocusIndicatorCheck[]): FocusIndicatorViolation[] {
  const violations: FocusIndicatorViolation[] = [];

  for (const check of checks) {
    const removal = check.focusClasses.find((raw) => baseUtility(raw) === REMOVAL_BASE);
    if (!removal) continue;

    const hasReplacement = check.focusClasses.some(isReplacement);
    if (hasReplacement) continue;

    violations.push({
      type: "focus-indicator",
      file: check.file,
      line: check.line,
      tagName: check.tagName,
      removalClass: removal,
    });
  }

  return violations;
}
