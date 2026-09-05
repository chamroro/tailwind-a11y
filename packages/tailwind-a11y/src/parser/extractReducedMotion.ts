import * as t from "@babel/types";
import { getStaticClassName, parseJSX, traverse } from "./babelInterop.js";

export interface ReducedMotionCheck {
  file: string;
  line: number;
  tagName: string;
  // All classes on the element, unfiltered -- checkReducedMotion.ts does
  // the shape/variant/identity-value classification (unscoped vs
  // motion-safe:-scoped transition, motion-reduce:-scoped guards,
  // interaction-scoped transform values), same "extractor collects
  // broadly, rule filters narrowly" split as extractFocusIndicators.ts/
  // checkFocusIndicator.ts.
  classes: string[];
}

const TRANSITION_BASES = new Set(["transition", "transition-all", "transition-transform"]);

// group-hover:/peer-hover:/etc. compile to the identical momentary-pseudo-
// class shape as bare hover:, just evaluated against an ancestor/sibling
// (.group/.peer marker) instead of the element itself -- verified against a
// real Tailwind v4 build (`.group-hover\:scale-110:is(:where(.group):hover *)`).
// Deliberately NOT extended to has-*:/arbitrary variants ([&:hover]:, already
// an established out-of-scope precedent for this file -- unbounded selector
// text, not a closed enumerable set) or in-*: (a real v4.1+ ancestor-state
// variant with the identical shape, but a legitimate separate follow-up, not
// folded into this set).
const INTERACTION_VARIANTS = new Set([
  "hover", "focus", "focus-visible", "focus-within", "active",
  "group-hover", "group-focus", "group-focus-visible", "group-focus-within", "group-active",
  "peer-hover", "peer-focus", "peer-focus-visible", "peer-focus-within", "peer-active",
]);

// Named groups/peers (`group-hover/sidebar:scale-110`) compile the group
// name into the variant token itself via a slash
// (`.group-hover\/sidebar\:scale-110:is(:where(.group\/sidebar):hover *)`),
// so variantSegments() returns "group-hover/sidebar" verbatim -- a plain
// Set.has() would miss it. Safe to slice on the first "/" and re-check:
// Tailwind's opacity-modifier slash (`text-black/50`) lives inside the base
// utility segment (after the last ":"), never inside a variant segment, so
// there's no collision to worry about here.
function isInteractionVariant(v: string): boolean {
  if (INTERACTION_VARIANTS.has(v)) return true;
  const slash = v.indexOf("/");
  return slash !== -1 && INTERACTION_VARIANTS.has(v.slice(0, slash));
}

function baseUtility(raw: string): string {
  return raw.slice(raw.lastIndexOf(":") + 1);
}

// Every variant applied to a class, in source order -- NOT just the one
// immediately before the base utility. Caught in independent review:
// Tailwind variants stack (`motion-safe:hover:scale-110` and
// `hover:motion-safe:scale-110` compile to the identical nested media query,
// confirmed against a real v4 build), so checking only the innermost
// segment made this extractor's own candidacy gate order-dependent -- it
// would only recognize the interaction variant when it happened to be
// written last, silently missing the equally valid `hover:motion-safe:...`
// ordering. checkReducedMotion.ts uses the same helper for the same reason.
function variantSegments(raw: string): string[] {
  return raw.split(":").slice(0, -1);
}

function isAnimateBase(base: string): boolean {
  return base.startsWith("animate-");
}

export function extractReducedMotionChecks(code: string, filePath: string): ReducedMotionCheck[] {
  const ast = parseJSX(code, filePath);
  if (!ast) return [];

  const checks: ReducedMotionCheck[] = [];

  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      const className = getStaticClassName(opening.attributes);
      if (!className) return;

      const classes = className.split(/\s+/).filter(Boolean);

      const hasTransitionBase = classes.some((raw) => TRANSITION_BASES.has(baseUtility(raw)));
      const hasInteractionClass = classes.some((raw) => variantSegments(raw).some(isInteractionVariant));
      // A second, independent candidacy path for animate-* utilities, which
      // carry their own `animation` property and need no transition-*  base
      // at all -- `hover:animate-bounce` alone must be a candidate even
      // though `hasTransitionBase` is false. Deliberately a SINGLE-class
      // condition (one class must be both an animate-* base AND
      // interaction-scoped in its own variant stack), not two independent
      // whole-element flags like hasTransitionBase/hasInteractionClass
      // above: unlike transition-transform (never itself interaction-scoped)
      // paired with a separate hover:scale-110, an animate-* class is
      // simultaneously its own trigger and its own animator. Two independent
      // flags would wrongly treat `animate-spin hover:text-red-500` (an
      // unscoped, continuously-running animation next to an unrelated hover
      // class) as a candidate -- that's 2.2.2 (Pause/Stop/Hide) territory,
      // not 2.3.3, per the same reasoning checkReducedMotion.ts already
      // documents for why unscoped animate-* is out of scope here.
      const hasInteractionScopedAnimate = classes.some((raw) => {
        const base = baseUtility(raw);
        return isAnimateBase(base) && variantSegments(raw).some(isInteractionVariant);
      });
      // Not a candidate at all unless there's some transition utility
      // (scoped or not) *and* some interaction-scoped class, OR an
      // interaction-scoped animate-* class -- narrows the set of elements
      // checkReducedMotion.ts has to reason about, without pre-deciding any
      // of the nuance (unscoped vs motion-safe:, identity/non-motion
      // animate-* names, motion-reduce: guards) that belongs in the rule.
      if ((!hasTransitionBase || !hasInteractionClass) && !hasInteractionScopedAnimate) return;

      checks.push({
        file: filePath,
        line: opening.loc?.start.line ?? 0,
        tagName: t.isJSXIdentifier(opening.name) ? opening.name.name : "unknown-element",
        classes,
      });
    },
  });

  return checks;
}
