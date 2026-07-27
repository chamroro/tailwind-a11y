import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import rule from "./focus-indicator.js";

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

ruleTester.run("focus-indicator", rule, {
  valid: [
    {
      name: "a real replacement ring is present",
      filename: "Ok.jsx",
      code: `export const Ok = () => <button className="focus:outline-none focus:ring-2">Save</button>;`,
    },
    {
      name: "the cross-variant real-world pattern passes",
      filename: "CrossVariant.jsx",
      code: `export const Ok = () => <button className="focus:outline-none focus-visible:ring-2">Save</button>;`,
    },
    {
      name: "non-interactive elements are ignored",
      filename: "NotInteractive.jsx",
      code: `export const D = () => <div className="focus:outline-none">x</div>;`,
    },
  ],
  invalid: [
    {
      name: "bare focus:outline-none with nothing else",
      filename: "Bare.jsx",
      code: `export const Save = () => <button className="focus:outline-none">Save</button>;`,
      errors: [
        {
          message: "<button> removes the focus outline (focus:outline-none) with no visible replacement (focus:ring-*/border-*/shadow-*/bg-*/outline-*)",
          line: 1,
          column: 1,
        },
      ],
    },
    {
      name: "a degenerate decoy replacement must not mask the removal (regression)",
      filename: "Decoy.jsx",
      code: `export const Save = () => <button className="focus:outline-none focus:ring-0">Save</button>;`,
      errors: [
        {
          message: "<button> removes the focus outline (focus:outline-none) with no visible replacement (focus:ring-*/border-*/shadow-*/bg-*/outline-*)",
          line: 1,
          column: 1,
        },
      ],
    },
  ],
  assertionOptions: { requireLocation: true, requireMessage: true },
});
