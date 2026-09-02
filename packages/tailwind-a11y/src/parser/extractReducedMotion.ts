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
const INTERACTION_VARIANTS = new Set(["hover", "focus", "focus-visible", "focus-within", "active"]);

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
      const hasInteractionClass = classes.some((raw) =>
        variantSegments(raw).some((v) => INTERACTION_VARIANTS.has(v))
      );
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
        return isAnimateBase(base) && variantSegments(raw).some((v) => INTERACTION_VARIANTS.has(v));
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
