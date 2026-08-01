import { RuleTester } from "eslint";
import { afterAll, describe, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import rule from "./contrast.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const fixtureDir = mkdtempSync(join(tmpdir(), "eslint-plugin-tailwind-a11y-"));
const customConfigPath = join(fixtureDir, "tailwind.config.js");
writeFileSync(
  customConfigPath,
  `module.exports = { theme: { extend: { colors: { brand: { 500: "#9ca3af" } } } } };` // same hex as gray-400
);

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run("contrast", rule, {
  valid: [
    {
      name: "sufficient contrast on the same element",
      filename: "Ok.jsx",
      code: `export const Ok = () => <p className="text-gray-900 bg-white">hi</p>;`,
    },
    {
      name: "dynamic className is skipped, not guessed",
      filename: "Dynamic.jsx",
      code: `export const D = ({ c }) => <p className={c}>hi</p>;`,
    },
    {
      name: "a custom-theme color is silently skipped with no configured theme",
      filename: "Brand.jsx",
      code: `export const Ok = () => <p className="text-brand-500 bg-white">hi</p>;`,
    },
  ],
  invalid: [
    {
      name: 'resolves a custom-theme color via settings["tailwind-a11y"].configPath',
      filename: "Brand.jsx",
      code: `export const Ok = () => <p className="text-brand-500 bg-white">hi</p>;`,
      settings: { "tailwind-a11y": { configPath: customConfigPath } },
      errors: [
        {
          message: "text-brand-500 on bg-white — ratio 2.54, needs 4.5 (AA)",
          line: 1,
          column: 1,
        },
      ],
    },
    {
      name: "background inherited from the direct parent",
      filename: "Card.jsx",
      code: [
        `export function Card() {`,
        `  return (`,
        `    <div className="bg-white">`,
        `      <p className="text-gray-400">low contrast</p>`,
        `    </div>`,
        `  );`,
        `}`,
      ].join("\n"),
      errors: [
        {
          message: "text-gray-400 on bg-white — ratio 2.54, needs 4.5 (AA); try text-gray-500 (4.83)",
          line: 4,
          column: 1,
        },
      ],
    },
  ],
  assertionOptions: { requireLocation: true, requireMessage: true },
});
