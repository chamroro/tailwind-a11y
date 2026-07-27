import { createRequire } from "node:module";
import type { ESLint } from "eslint";
import contrast from "./rules/contrast.js";
import touchTarget from "./rules/touch-target.js";
import focusIndicator from "./rules/focus-indicator.js";

// `../package.json` resolves correctly from both `src/` (dev) and `dist/`
// (published), so the plugin version can't drift from the package version.
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const plugin: ESLint.Plugin = {
  meta: {
    name: "eslint-plugin-tailwind-a11y",
    version,
    namespace: "tailwind-a11y",
  },
  rules: {
    contrast,
    "touch-target": touchTarget,
    "focus-indicator": focusIndicator,
  },
  configs: {},
};

// Assigned after `plugin` exists so the config can reference the plugin
// itself. Scoped to jsx/tsx to match cli.ts's default glob, and to avoid
// the engine's unparsable-file console warning firing as confusing noise
// inside an unrelated linter run.
Object.assign(plugin.configs!, {
  recommended: [
    {
      name: "tailwind-a11y/recommended",
      files: ["**/*.jsx", "**/*.tsx"],
      // Espree (ESLint's default parser) doesn't parse JSX unless told to —
      // without this, ESLint fails to parse .jsx files at all before any
      // rule here runs. Doesn't cover TypeScript syntax in .tsx files; see
      // README for the TS-parser caveat.
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { "tailwind-a11y": plugin },
      rules: {
        "tailwind-a11y/contrast": "error",
        "tailwind-a11y/touch-target": "error",
        "tailwind-a11y/focus-indicator": "error",
      },
    },
  ],
});

export default plugin;
