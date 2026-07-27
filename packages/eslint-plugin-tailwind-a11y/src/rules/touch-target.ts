import type { Rule } from "eslint";
import { extractTouchTargetChecks, checkTouchTargets } from "tailwind-a11y";

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce WCAG 2.5.8 AA minimum 24x24px touch targets on interactive elements sized with Tailwind w-*/h-* classes",
      recommended: true,
      url: "https://github.com/chamroro/eslint-plugin-tailwind-a11y#touch-target",
    },
    schema: [],
    messages: {
      touchTarget:
        "<{{tagName}}> is {{widthPx}}×{{heightPx}}px ({{widthClass}} {{heightClass}}) — WCAG 2.5.8 requires >= 24×24px",
    },
  },

  create(context) {
    return {
      Program() {
        const violations = checkTouchTargets(extractTouchTargetChecks(context.sourceCode.getText(), context.filename));

        for (const v of violations) {
          context.report({
            loc: { line: v.line, column: 0 },
            messageId: "touchTarget",
            data: {
              tagName: v.tagName,
              widthPx: v.widthPx,
              heightPx: v.heightPx,
              widthClass: v.widthClass,
              heightClass: v.heightClass,
            },
          });
        }
      },
    };
  },
};

export default rule;
