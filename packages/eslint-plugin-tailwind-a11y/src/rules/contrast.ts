import type { Rule } from "eslint";
import { extractChecks, checkContrast } from "tailwind-a11y";
import { resolveThemeForContext } from "../theme.js";

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
      // Separate messageId rather than an optional {{suggestion}} placeholder
      // in the base template — ESLint's interpolate() renders literal
      // "undefined" if the data key is present-but-undefined, and RuleTester
      // hard-fails on an unsubstituted {{placeholder}} if the key is omitted.
      contrastWithSuggestion:
        "{{textClass}} on {{bgClass}} — ratio {{ratio}}, needs {{required}} ({{level}}); try {{suggestion}} ({{suggestedRatio}})",
    },
  },

  create(context) {
    return {
      // Runs once per file — the engine does its own independent Babel
      // parse of the raw source, so this never participates in ESLint's
      // own AST traversal.
      Program() {
        const { palette } = resolveThemeForContext(context);
        const violations = checkContrast(extractChecks(context.sourceCode.getText(), context.filename), palette);

        for (const v of violations) {
          const data: Record<string, string | number> = {
            textClass: v.textClass,
            bgClass: v.bgClass,
            ratio: v.ratio.toFixed(2),
            required: v.required,
            level: v.level,
          };
          if (v.suggestion) {
            data.suggestion = v.suggestion;
            data.suggestedRatio = v.suggestedRatio!.toFixed(2);
          }
          context.report({
            loc: { line: v.line, column: 0 },
            messageId: v.suggestion ? "contrastWithSuggestion" : "contrast",
            data,
          });
        }
      },
    };
  },
};

export default rule;
