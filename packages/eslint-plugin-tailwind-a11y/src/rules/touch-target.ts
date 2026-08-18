import type { Rule } from "eslint";
import { extractTouchTargetChecks, checkTouchTargets } from "tailwind-a11y";
import { resolveThemeForContext } from "../theme.js";

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce WCAG 2.5.8 AA minimum 24x24px touch targets on interactive elements sized with Tailwind w-*/h-* classes",
      recommended: true,
      url: "https://github.com/chamroro/tailwind-a11y/tree/main/packages/eslint-plugin-tailwind-a11y#touch-target",
    },
    // First rule in this codebase to need a non-empty schema -- configPath
    // deliberately lives in context.settings instead of options (see
    // theme.ts), since it's cross-cutting across all three rules. strict is
    // touch-target-specific, so it belongs on this rule's own options, not
    // bundled into that shared object.
    schema: [{ type: "object", properties: { strict: { type: "boolean" } }, additionalProperties: false }],
    messages: {
      touchTarget:
        "<{{tagName}}> is {{widthPx}}×{{heightPx}}px ({{widthClass}} {{heightClass}}) — WCAG {{wcagSC}} requires >= {{requiredPx}}×{{requiredPx}}px",
    },
  },

  create(context) {
    return {
      Program() {
        const { spacing } = resolveThemeForContext(context);
        const strict = (context.options[0] as { strict?: boolean } | undefined)?.strict ?? false;
        const violations = checkTouchTargets(
          extractTouchTargetChecks(context.sourceCode.getText(), context.filename, spacing),
          strict
        );

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
              requiredPx: v.required,
              wcagSC: v.level === "AAA" ? "2.5.5" : "2.5.8",
            },
          });
        }
      },
    };
  },
};

export default rule;
