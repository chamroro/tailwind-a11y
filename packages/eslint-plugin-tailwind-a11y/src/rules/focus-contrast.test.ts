import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import rule from "./focus-contrast.js";

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

ruleTester.run("focus-contrast", rule, {
  valid: [
    {
      name: "a high-contrast ring (white on blue-500) passes by default",
      filename: "Ok.jsx",
      code: `export const Ok = () => <button className="bg-blue-500 focus:outline-none focus:ring-2 focus:ring-white" onClick={() => {}}>x</button>;`,
    },
    {
      name: "a high-contrast, sufficiently-thick ring passes under strict too",
      filename: "OkStrict.jsx",
      code: `export const Ok = () => <button className="bg-blue-500 focus:outline-none focus:ring-2 focus:ring-white" onClick={() => {}}>x</button>;`,
      options: [{ strict: true }],
    },
    {
      name: "no explicit outline-*/ring-* color is out of scope, not flagged",
      filename: "NoColor.jsx",
      code: `export const D = () => <button className="bg-blue-500 focus:outline-none focus:border-4 focus:border-blue-400" onClick={() => {}}>x</button>;`,
    },
    {
      name: "thin ring-1 passes by default (thickness only assessed under strict)",
      filename: "Thin.jsx",
      code: `export const Ok = () => <button className="bg-blue-500 focus:outline-none focus:ring-1 focus:ring-white" onClick={() => {}}>x</button>;`,
    },
  ],
  invalid: [
    {
      name: "a low-contrast ring (blue-400 on blue-500) fails by default — the case focus-indicator alone misses",
      filename: "LowContrast.jsx",
      code: `export const B = () => <button className="bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400" onClick={() => {}}>x</button>;`,
      errors: [
        {
          message: "<button> focus indicator focus:ring-blue-400 on bg-blue-500 — ratio 1.45, needs 3 (WCAG 1.4.11)",
          line: 1,
          column: 1,
        },
      ],
    },
    {
      name: "a high-contrast but too-thin ring fails under strict — thickness is independent of contrast",
      filename: "Thin.jsx",
      code: `export const B = () => <button className="bg-blue-500 focus:outline-none focus:ring-1 focus:ring-white" onClick={() => {}}>x</button>;`,
      options: [{ strict: true }],
      errors: [
        {
          message:
            "<button> focus indicator focus:ring-white on bg-blue-500 — ratio 3.68, needs 3 (WCAG 2.4.13); also only 1px thick, needs >= 2px",
          line: 1,
          column: 1,
        },
      ],
    },
  ],
  assertionOptions: { requireLocation: true, requireMessage: true },
});
