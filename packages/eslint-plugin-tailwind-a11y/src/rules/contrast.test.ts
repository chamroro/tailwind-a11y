import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import rule from "./contrast.js";

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
  ],
  invalid: [
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
