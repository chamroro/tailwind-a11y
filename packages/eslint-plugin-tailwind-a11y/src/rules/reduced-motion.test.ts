import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import rule from "./reduced-motion.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run("reduced-motion", rule, {
  valid: [
    {
      name: "a motion-reduce:transform-none guard passes",
      filename: "Ok.jsx",
      code: `export const Ok = () => <div className="transition-transform hover:scale-110 motion-reduce:transform-none">x</div>;`,
    },
    {
      name: "a transition scoped under motion-safe: instead of unscoped passes",
      filename: "Ok2.jsx",
      code: `export const Ok = () => <div className="motion-safe:transition-transform hover:scale-110">x</div>;`,
    },
    {
      name: "transition-colors doesn't animate transform, so no violation",
      filename: "Colors.jsx",
      code: `export const D = () => <div className="transition-colors hover:scale-110">x</div>;`,
    },
    {
      name: "an identity-value interaction utility (scale-100) is not real motion",
      filename: "Identity.jsx",
      code: `export const D = () => <div className="transition-transform hover:scale-100">x</div>;`,
    },
  ],
  invalid: [
    {
      name: "an unscoped transition-transform with an interaction-scoped scale and no guard is enabling this rule's opt-in, so it fires without a strict option",
      filename: "Card.jsx",
      code: `export const Card = () => <div className="transition-transform hover:scale-110">x</div>;`,
      errors: [
        {
          message:
            "<div> animates hover:scale-110 via transition-transform with no motion-reduce:transition-none/transform-none guard — WCAG 2.3.3 requires motion animation triggered by interaction to be disableable",
          line: 1,
          column: 1,
        },
      ],
    },
  ],
  assertionOptions: { requireLocation: true, requireMessage: true },
});
