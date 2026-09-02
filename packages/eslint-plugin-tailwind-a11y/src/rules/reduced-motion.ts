import type { Rule } from "eslint";
import { extractReducedMotionChecks, checkReducedMotion } from "tailwind-a11y";

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce WCAG 2.3.3 AAA -- interaction-triggered transform animation (scale/rotate/translate/skew under hover:/focus:/active:) or animate-spin/-ping/-bounce under the same variants must be disableable via prefers-reduced-motion",
      recommended: true,
      url: "https://github.com/chamroro/tailwind-a11y/tree/main/packages/eslint-plugin-tailwind-a11y#reduced-motion",
    },
    // No AA tier to fall back to for this SC, unlike touch-target/
    // focus-contrast -- no strict option, same schema: [] as the original
    // focus-indicator rule. checkReducedMotion() itself defaults to
    // reporting nothing unless told `strict` (the CLI/VS Code/GitHub Action
    // gate this behind --strict/tailwind-a11y.strict/INPUT_STRICT, since
    // those tools scan everything by default and an AAA-only check
    // shouldn't silently start failing existing users' CI on upgrade) --
    // here, enabling this rule at all is already that opt-in gesture, so
    // this is the one caller that always passes `true`.
    schema: [],
    // Two messageIds, not one with a conditional {{placeholder}} -- ESLint's
    // mustache-style templates can't branch on data, and the animate
    // mechanism has no transitionClass to interpolate at all (see
    // ReducedMotionViolation's discriminated union in the engine).
    messages: {
      reducedMotionTransition:
        "<{{tagName}}> animates {{motionClass}} via {{transitionClass}} with no motion-reduce:transition-none/transform-none guard — WCAG 2.3.3 requires motion animation triggered by interaction to be disableable",
      reducedMotionAnimate:
        "<{{tagName}}> animates {{motionClass}} via a CSS animation with no motion-reduce:animate-none guard — WCAG 2.3.3 requires motion animation triggered by interaction to be disableable",
    },
  },

  create(context) {
    return {
      Program() {
        const violations = checkReducedMotion(
          extractReducedMotionChecks(context.sourceCode.getText(), context.filename),
          true
        );

        for (const v of violations) {
          if (v.mechanism === "animate") {
            context.report({
              loc: { line: v.line, column: 0 },
              messageId: "reducedMotionAnimate",
              data: { tagName: v.tagName, motionClass: v.motionClass },
            });
          } else {
            context.report({
              loc: { line: v.line, column: 0 },
              messageId: "reducedMotionTransition",
              data: { tagName: v.tagName, motionClass: v.motionClass, transitionClass: v.transitionClass },
            });
          }
        }
      },
    };
  },
};

export default rule;
