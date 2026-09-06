import type { ReducedMotionCheck } from "../parser/extractReducedMotion.js";

// Two independently-detected mechanisms under one WCAG 2.3.3 citation, not
// one enriched shape: a transition-mechanism violation always has a real
// transitionClass; an animate-mechanism violation has none at all (animate-*
// utilities carry their own `animation` property and are simultaneously
// their own trigger and their own animator -- there is no separate
// transition utility to name, so reusing `transitionClass` with the animate
// class itself would read as "animates X via X"). Both can fire on the same
// element independently.
export type ReducedMotionViolation =
  | {
      type: "reduced-motion";
      mechanism: "transition";
      file: string;
      line: number;
      tagName: string;
      transitionClass: string;
      motionClass: string;
      level: "AAA"; // no AA tier exists for this SC to fall back to
    }
  | {
      type: "reduced-motion";
      mechanism: "animate";
      file: string;
      line: number;
      tagName: string;
      motionClass: string;
      level: "AAA";
    };

// Verified against a real Tailwind v4 build: only these three include
// transform/translate/scale/rotate in their transition-property list.
// transition-colors/-opacity/-shadow don't -- so a scale/rotate/translate
// change under hover on an element with only one of those never actually
// animates (the browser has nothing telling it to transition that
// property), and correctly isn't flagged.
const TRANSITION_BASES = new Set(["transition", "transition-all", "transition-transform"]);

// group-hover:/peer-hover:/etc. compile to the identical momentary-pseudo-
// class shape as bare hover:, just evaluated against an ancestor/sibling
// (.group/.peer marker) instead of the element itself -- see the identical
// set (and full explanation) in extractReducedMotion.ts. Deliberately NOT
// extended to has-*:/arbitrary variants or in-*: -- see that file's comment.
const INTERACTION_VARIANTS = new Set([
  "hover", "focus", "focus-visible", "focus-within", "active",
  "group-hover", "group-focus", "group-focus-visible", "group-focus-within", "group-active",
  "peer-hover", "peer-focus", "peer-focus-visible", "peer-focus-within", "peer-active",
]);

// Named groups/peers (`group-hover/sidebar:...`) put the group name in the
// variant token itself via a slash -- see extractReducedMotion.ts for the
// full explanation of why slicing on the first "/" is safe here.
function isInteractionVariant(v: string): boolean {
  if (INTERACTION_VARIANTS.has(v)) return true;
  const slash = v.indexOf("/");
  return slash !== -1 && INTERACTION_VARIANTS.has(v.slice(0, slash));
}

function baseUtility(raw: string): string {
  return raw.slice(raw.lastIndexOf(":") + 1);
}

// Every variant applied to a class, in source order -- see the identical
// helper (and full explanation) in extractReducedMotion.ts. Duplicated
// rather than imported, matching this codebase's own established
// precedent of small per-file primitives (e.g. checkFocusIndicator.ts's own
// baseUtility is separate from extractFocusIndicators.ts's).
function variantSegments(raw: string): string[] {
  return raw.split(":").slice(0, -1);
}

// Positive shape filter, not a denylist -- same reasoning as COLOR_TOKEN in
// extractClasses.ts. Excludes each utility's identity value (scale-100,
// rotate-0, translate-x-0/-y-0, skew-x-0/-y-0), since those utilities are
// real but move nothing -- flagging them would be a false positive, the
// same "shape looks real but isn't" failure class this project has hit
// before. Arbitrary bracket values (scale-[1.5]) and 3D transform utilities
// (rotate-x-*, translate-z-*, ...) are out of scope for v1 -- unmatched, so
// silently not considered "motion" here rather than guessed at.
const SCALE_RE = /^(scale|scale-x|scale-y)-(\d+)$/;
const ROTATE_RE = /^-?rotate-(\d+(?:\.\d+)?)$/;
const TRANSLATE_RE = /^-?(translate-x|translate-y)-(\d+(?:\.\d+)?)$/;
const SKEW_RE = /^-?(skew-x|skew-y)-(\d+(?:\.\d+)?)$/;

function isNonIdentityMotionUtility(base: string): boolean {
  const scale = SCALE_RE.exec(base);
  if (scale) return Number(scale[2]) !== 100;
  const rotate = ROTATE_RE.exec(base);
  if (rotate) return Number(rotate[1]) !== 0;
  const translate = TRANSLATE_RE.exec(base);
  if (translate) return Number(translate[2]) !== 0;
  const skew = SKEW_RE.exec(base);
  if (skew) return Number(skew[2]) !== 0;
  return false;
}

// Verified against a real Tailwind v4 build's compiled keyframes:
// animate-spin -> rotate(360deg) (orientation/shape change), animate-ping ->
// scale(2)+opacity:0 (includes a size change), animate-bounce ->
// translateY(-25%) (position change) -- all three qualify as "motion
// animation" per this project's own WCAG 2.3.3 boundary (size/shape/
// position, not color/opacity/blur). animate-pulse is opacity-only (excluded,
// same reason color/opacity transitions don't count above) and animate-none
// is the off/identity value (excluded, same treatment as scale-100/rotate-0).
// A fully enumerated set, not a regex -- unlike scale/rotate/translate/skew,
// none of these utilities take an arbitrary numeric value to range-check.
const ANIMATE_MOTION_BASES = new Set(["animate-spin", "animate-ping", "animate-bounce"]);

// `strict` gates the whole check for the scan-everything-by-default
// adapters (CLI/VS Code/GitHub Action) -- WCAG 2.3.3 is AAA-only, and
// unconditionally enabling a brand-new AAA check would silently start
// failing existing users' CI on a routine upgrade, unlike a genuine AA
// baseline (2.4.7's focus-indicator check, the one other check in this file
// with no strict tier). Consistent with this project's own `strict` =
// "hold every check to its AAA tier where one exists" framing. The ESLint
// rule is the one caller that always passes `true` regardless -- enabling
// `tailwind-a11y/reduced-motion` in an ESLint config is itself the opt-in
// gesture there, so a second gate on top would just make the rule silently
// report nothing when a user enabled it expecting it to check something.
export function checkReducedMotion(checks: ReducedMotionCheck[], strict = false): ReducedMotionViolation[] {
  if (!strict) return [];

  const violations: ReducedMotionViolation[] = [];

  for (const check of checks) {
    let realTransition: string | null = null;
    let hasMotionReduceGuard = false;

    for (const raw of check.classes) {
      const base = baseUtility(raw);
      const segments = variantSegments(raw);

      // A transition counts as "real" (needs checking) unless its variant
      // stack makes it not actually apply at the moment the interaction
      // begins:
      //  - an interaction pseudo-class (hover:/focus:/focus-within:/
      //    active:) anywhere in the stack means the transition-property
      //    only exists *during* that momentary state, not before it -- CSS
      //    has nothing to transition *from* right as the interaction
      //    starts, so `hover:transition-transform hover:scale-110` still
      //    snaps instantly, same as before this fix (this is the one case
      //    the original `segments.length === 0` check happened to get
      //    right, so it's preserved here under its real reason instead).
      //  - motion-safe: anywhere in the stack means the transition simply
      //    doesn't exist unless motion is already safe -- a complete,
      //    persistent exemption, unrelated to interaction timing.
      // Any *other* scoping (dark:, sm:, lg:, ...) is a persistent
      // precondition, not a momentary one -- the transition genuinely is
      // present in the resting state whenever that condition holds, with
      // zero relationship to prefers-reduced-motion. Caught in independent
      // adversarial testing: the previous version required
      // `segments.length === 0` (no variant at all), so
      // `dark:transition hover:scale-110` was silently treated as
      // compliant even though it animates on hover in dark mode
      // regardless of the user's motion preference.
      const isInteractionGated = segments.some(isInteractionVariant);
      const isMotionSafeGated = segments.includes("motion-safe");
      if (TRANSITION_BASES.has(base) && !isInteractionGated && !isMotionSafeGated) realTransition = raw;

      // Only a *bare* motion-reduce:transition-none/transform-none (no
      // other variant stacked with it) is trusted as a full guard --
      // caught in independent adversarial testing: `sm:motion-reduce:
      // transition-none` was being accepted as fully protective even
      // though it only suppresses the transition at/above the `sm`
      // breakpoint, leaving it completely unguarded below that width.
      // Correctly modeling arbitrary variant-subset relationships (does
      // this guard's other conditions always hold whenever the real
      // trigger's conditions hold?) is out of scope -- requiring the
      // guard to be unconditional is the same "skip/flag rather than
      // guess" posture used everywhere else in this project, erring
      // toward a false positive over the worse failure mode, a false
      // negative.
      if (segments.length === 1 && segments[0] === "motion-reduce" && (base === "transition-none" || base === "transform-none")) {
        hasMotionReduceGuard = true;
      }
    }

    // Independent detection path for the animate-* mechanism -- deliberately
    // NOT nested after the transition path's `continue`s below, since
    // `hover:animate-bounce` alone has no transition base at all
    // (realTransition stays null), which would skip past this block entirely
    // if it were placed after the `if (!realTransition) continue;` line. A
    // single element can have a real violation on both mechanisms at once
    // (independently pushed), or on just one -- they don't race for one slot.
    const hasMotionReduceAnimateGuard = check.classes.some((raw) => {
      const segments = variantSegments(raw);
      return segments.length === 1 && segments[0] === "motion-reduce" && baseUtility(raw) === "animate-none";
    });
    const animateMotionClass = check.classes.find((raw) => {
      const segments = variantSegments(raw);
      // Same self-guard and interaction-scoping reasoning as the transition
      // side's motionClass find below -- see its comment for the full
      // explanation of why both checks are per-candidate, not per-element.
      if (segments.includes("motion-safe")) return false;
      if (!segments.some(isInteractionVariant)) return false;
      return ANIMATE_MOTION_BASES.has(baseUtility(raw));
    });
    if (animateMotionClass && !hasMotionReduceAnimateGuard) {
      violations.push({
        type: "reduced-motion",
        mechanism: "animate",
        file: check.file,
        line: check.line,
        tagName: check.tagName,
        motionClass: animateMotionClass,
        level: "AAA",
      });
    }

    // No real (non-motion-safe-guarded) transition at all means it simply
    // doesn't exist unless motion is already safe -- a complete
    // alternative way of satisfying 2.3.3, not a partial one -- so this
    // correctly falls through as a pass, not a skip-because-unresolvable.
    if (!realTransition) continue;
    if (hasMotionReduceGuard) continue;

    const motionClass = check.classes.find((raw) => {
      const segments = variantSegments(raw);
      // motion-safe: anywhere in this specific class's own variant stack
      // means the motion utility itself doesn't apply unless motion is
      // already safe -- the same complete-alternative reasoning as the
      // transition side above, just checked per-candidate instead of once
      // for the whole element (a class can be interaction-scoped *and*
      // self-guarded at the same time, e.g. `hover:motion-safe:scale-110`).
      if (segments.includes("motion-safe")) return false;
      if (!segments.some(isInteractionVariant)) return false;
      return isNonIdentityMotionUtility(baseUtility(raw));
    });
    if (!motionClass) continue; // no real, un-self-guarded motion actually triggered by interaction

    violations.push({
      type: "reduced-motion",
      mechanism: "transition",
      file: check.file,
      line: check.line,
      tagName: check.tagName,
      transitionClass: realTransition,
      motionClass,
      level: "AAA",
    });
  }

  return violations;
}
