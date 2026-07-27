import type { Rule } from "eslint";
import { extractFocusIndicatorChecks, checkFocusIndicators } from "tailwind-a11y";

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Enforce WCAG 2.4.7 AA visible focus indicators — flag focus:outline-none with no visible replacement",
      recommended: true,
      url: "https://github.com/chamroro/eslint-plugin-tailwind-a11y#focus-indicator",
    },
    schema: [],
    messages: {
      focusIndicator:
        "<{{tagName}}> removes the focus outline ({{removalClass}}) with no visible replacement (focus:ring-*/border-*/shadow-*/bg-*/outline-*)",
    },
  },

  create(context) {
    return {
      Program() {
        const violations = checkFocusIndicators(extractFocusIndicatorChecks(context.sourceCode.getText(), context.filename));

        for (const v of violations) {
          context.report({
            loc: { line: v.line, column: 0 },
            messageId: "focusIndicator",
            data: { tagName: v.tagName, removalClass: v.removalClass },
          });
        }
      },
    };
  },
};

export default rule;
