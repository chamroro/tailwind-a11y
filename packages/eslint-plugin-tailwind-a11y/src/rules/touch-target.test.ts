import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import rule from "./touch-target.js";

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

ruleTester.run("touch-target", rule, {
  valid: [
    {
      name: "exactly 24x24 passes (minimum is inclusive)",
      filename: "Ok.jsx",
      code: `export const Ok = () => <button className="w-6 h-6" onClick={() => {}}>x</button>;`,
    },
    {
      name: "non-interactive elements are ignored",
      filename: "NotInteractive.jsx",
      code: `export const D = () => <div className="w-4 h-4">x</div>;`,
    },
  ],
  invalid: [
    {
      name: "16x16 icon button fails",
      filename: "IconButton.jsx",
      code: `export const IconButton = () => <button className="w-4 h-4" onClick={() => {}}>x</button>;`,
      errors: [
        {
          message: "<button> is 16×16px (w-4 h-4) — WCAG 2.5.8 requires >= 24×24px",
          line: 1,
          column: 1,
        },
      ],
    },
    {
      name: "a hover: variant size must not mask the real resting-state size (regression)",
      filename: "HoverDecoy.jsx",
      code: `export const B = () => <button className="hover:w-24 w-4 h-4" onClick={() => {}}>x</button>;`,
      errors: [
        {
          message: "<button> is 16×16px (w-4 h-4) — WCAG 2.5.8 requires >= 24×24px",
          line: 1,
          column: 1,
        },
      ],
    },
  ],
  assertionOptions: { requireLocation: true, requireMessage: true },
});
