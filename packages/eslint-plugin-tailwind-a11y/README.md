# eslint-plugin-tailwind-a11y

ESLint rules for [`tailwind-a11y`](https://github.com/chamroro/tailwind-a11y/tree/main/packages/tailwind-a11y) —
inline WCAG diagnostics during normal linting, powered by the same engine as the CLI
and VS Code extension. No detection logic is duplicated, so results never disagree.

## Install

```bash
npm install --save-dev eslint-plugin-tailwind-a11y
```

Requires ESLint 9 or 10 (flat config).

## Usage

```js
// eslint.config.js
import tailwindA11y from "eslint-plugin-tailwind-a11y";

export default [...tailwindA11y.configs.recommended];
```

Or register rules individually:

```js
export default [
  {
    files: ["**/*.jsx", "**/*.tsx"],
    plugins: { "tailwind-a11y": tailwindA11y },
    rules: {
      "tailwind-a11y/contrast": "error",
      "tailwind-a11y/touch-target": "warn",
      "tailwind-a11y/focus-indicator": "error",
    },
  },
];
```

## Rules

| Rule | WCAG | Detects |
|---|---|---|
| `contrast` | 1.4.3 (AA) | Low-contrast `text-*`/`bg-*` pairs — suggests the nearest passing shade |
| `touch-target` | 2.5.8 (AA) | Interactive elements under 24×24px |
| `focus-indicator` | 2.4.7 (AA) | `focus:outline-none` with no visible replacement |

Exact scope and known limitations: [engine README](https://github.com/chamroro/tailwind-a11y/tree/main/packages/tailwind-a11y#scope).

## Custom theme

A `tailwind.config.js`/`.cjs` (Tailwind v3) or a CSS `@theme` file like
`app/globals.css` (Tailwind v4) in ESLint's cwd is auto-detected; point at a specific
file instead via `settings`:

```js
export default [
  ...tailwindA11y.configs.recommended,
  { settings: { "tailwind-a11y": { configPath: "./tailwind.config.cjs" } } },
];
```

## Notes

`.tsx` files need a TypeScript-aware `languageOptions.parser` (e.g. `typescript-eslint`)
in your own config for ESLint to parse them at all. This plugin's own analysis
understands TypeScript syntax regardless — but ESLint has to parse the file successfully
before any rule, including this one, ever runs.

## License

MIT
