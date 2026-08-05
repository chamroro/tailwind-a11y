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

// Same failure mode again, one prefix-family level up: these utilities
// share the bg-*/border-* prefix but control layout/rendering *behavior*
// (attachment, repeat, size, clip, origin, position, table border mode),
// not a visible color/width/style that could replace a removed outline.
// Enumerated, not derived -- a future Tailwind utility sharing one of
// these prefixes without providing visible styling could reintroduce this
// gap, the same maintenance caveat as DEGENERATE_BASES/MODIFIER_ONLY above.
const NON_VISUAL_BASES = new Set([
  "bg-fixed", "bg-local", "bg-scroll",
  "bg-repeat", "bg-no-repeat", "bg-repeat-x", "bg-repeat-y", "bg-repeat-round", "bg-repeat-space",
  "bg-auto", "bg-cover", "bg-contain",
  "bg-clip-border", "bg-clip-padding", "bg-clip-content", "bg-clip-text",
  "bg-origin-border", "bg-origin-padding", "bg-origin-content",
  "bg-none",
  "bg-bottom", "bg-center", "bg-left", "bg-left-bottom", "bg-left-top",
  "bg-right", "bg-right-bottom", "bg-right-top", "bg-top",
  "border-collapse", "border-separate",
]);

// bg-blend-{mode} (e.g. bg-blend-multiply) sets a blend mode, not a color --
// suffix-varying like MODIFIER_ONLY above, so pattern-matched instead of
// enumerated.
const NON_VISUAL_PATTERN = /^bg-blend-/;

function baseUtility(raw: string): string {
  return raw.slice(raw.lastIndexOf(":") + 1);
}

function isReplacement(raw: string): boolean {
  const base = baseUtility(raw);
  if (DEGENERATE_BASES.has(base) || MODIFIER_ONLY.test(base)) return false;
  if (NON_VISUAL_BASES.has(base) || NON_VISUAL_PATTERN.test(base)) return false;
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
