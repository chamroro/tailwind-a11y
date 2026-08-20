import type { Rule } from "eslint";
import { extractFocusIndicatorChecks, checkFocusContrast } from "tailwind-a11y";
import { resolveThemeForContext } from "../theme.js";

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce WCAG 1.4.11 AA (3:1) contrast for focus indicators — flag a present outline/ring whose color is too close to the background to actually see",
      recommended: true,
      url: "https://github.com/chamroro/tailwind-a11y/tree/main/packages/eslint-plugin-tailwind-a11y#focus-contrast",
    },
    // strict is this rule's own option (WCAG 2.4.13 AAA minimum thickness),
    // independently configurable from touch-target's identically-shaped
    // strict option -- see touch-target.ts for why this lives in options,
    // not context.settings.
    schema: [{ type: "object", properties: { strict: { type: "boolean" } }, additionalProperties: false }],
    messages: {
      focusContrast:
        "<{{tagName}}> focus indicator {{indicatorClass}} on {{bgClass}} — ratio {{ratio}}, needs {{required}} (WCAG {{wcagSC}})",
      focusContrastWithThickness:
        "<{{tagName}}> focus indicator {{indicatorClass}} on {{bgClass}} — ratio {{ratio}}, needs {{required}} (WCAG {{wcagSC}}); also only {{thicknessPx}}px thick, needs >= {{requiredThicknessPx}}px",
    },
  },

  create(context) {
    return {
      Program() {
        const { palette } = resolveThemeForContext(context);
        const strict = (context.options[0] as { strict?: boolean } | undefined)?.strict ?? false;
        const violations = checkFocusContrast(
          extractFocusIndicatorChecks(context.sourceCode.getText(), context.filename),
          strict,
          palette
        );

        for (const v of violations) {
          const wcagSC = v.level === "AAA" ? "2.4.13" : "1.4.11";
          context.report({
            loc: { line: v.line, column: 0 },
            messageId: v.thicknessPx !== undefined ? "focusContrastWithThickness" : "focusContrast",
            data: {
              tagName: v.tagName,
              indicatorClass: v.indicatorClass,
              bgClass: v.bgClass,
              ratio: v.ratio.toFixed(2),
              required: String(v.required),
              wcagSC,
              ...(v.thicknessPx !== undefined
                ? { thicknessPx: String(v.thicknessPx), requiredThicknessPx: String(v.requiredThicknessPx) }
                : {}),
            },
          });
        }
      },
    };
  },
};

export default rule;
