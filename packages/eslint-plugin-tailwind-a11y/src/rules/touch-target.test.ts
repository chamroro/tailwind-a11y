import { RuleTester } from "eslint";
import { afterAll, describe, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import rule from "./touch-target.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const fixtureDir = mkdtempSync(join(tmpdir(), "eslint-plugin-tailwind-a11y-"));
const customConfigPath = join(fixtureDir, "tailwind.config.js");
writeFileSync(customConfigPath, `module.exports = { theme: { extend: { spacing: { "5.5": "1.375rem" } } } };`); // 22px

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

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
    {
      name: "a custom spacing token is silently skipped with no configured theme",
      filename: "Small.jsx",
      code: `export const Small = () => <button className="w-5.5 h-5.5" onClick={() => {}}>x</button>;`,
    },
    {
      name: "40x40 passes by default (strict option not set)",
      filename: "Ok40.jsx",
      code: `export const Ok = () => <button className="w-10 h-10" onClick={() => {}}>x</button>;`,
    },
    {
      name: "exactly 44x44 passes under strict (minimum is inclusive, same as the default 24px)",
      filename: "Ok44.jsx",
      code: `export const Ok = () => <button className="w-11 h-11" onClick={() => {}}>x</button>;`,
      options: [{ strict: true }],
    },
  ],
  invalid: [
    {
      name: 'resolves a custom spacing token via settings["tailwind-a11y"].configPath',
      filename: "Small.jsx",
      code: `export const Small = () => <button className="w-5.5 h-5.5" onClick={() => {}}>x</button>;`,
      settings: { "tailwind-a11y": { configPath: customConfigPath } },
      errors: [
        {
          message: "<button> is 22×22px (w-5.5 h-5.5) — WCAG 2.5.8 requires >= 24×24px",
          line: 1,
          column: 1,
        },
      ],
    },
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
    {
      name: "40x40 fails under strict, reporting WCAG 2.5.5 and the 44px threshold",
      filename: "Strict40.jsx",
      code: `export const B = () => <button className="w-10 h-10" onClick={() => {}}>x</button>;`,
      options: [{ strict: true }],
      errors: [
        {
          message: "<button> is 40×40px (w-10 h-10) — WCAG 2.5.5 requires >= 44×44px",
          line: 1,
          column: 1,
        },
      ],
    },
  ],
  assertionOptions: { requireLocation: true, requireMessage: true },
});
