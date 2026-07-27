import type { Rule } from "eslint";
import { extractChecks, checkContrast } from "tailwind-a11y";

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Enforce WCAG 1.4.3 AA color contrast between Tailwind text-* and bg-* classes",
      recommended: true,
      url: "https://github.com/chamroro/tailwind-a11y/tree/main/packages/eslint-plugin-tailwind-a11y#contrast",
    },
    schema: [],
    messages: {
      contrast: "{{textClass}} on {{bgClass}} — ratio {{ratio}}, needs {{required}} ({{level}})",
    },
  },

  create(context) {
    return {
      // Runs once per file — the engine does its own independent Babel
      // parse of the raw source, so this never participates in ESLint's
      // own AST traversal.
      Program() {
        const violations = checkContrast(extractChecks(context.sourceCode.getText(), context.filename));

        for (const v of violations) {
          context.report({
            loc: { line: v.line, column: 0 },
            messageId: "contrast",
            data: {
              textClass: v.textClass,
              bgClass: v.bgClass,
              ratio: v.ratio.toFixed(2),
              required: v.required,
              level: v.level,
            },
          });
        }
      },
    };
  },
};

export default rule;
