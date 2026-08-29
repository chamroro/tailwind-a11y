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
      "tailwind-a11y/focus-contrast": "error",
    },
  },
];
```

## Rules

| Rule | WCAG | Detects |
|---|---|---|
| `contrast` | 1.4.3 (AA) | Low-contrast `text-*`/`bg-*` pairs — suggests the nearest passing shade |
| `touch-target` | 2.5.8 (AA) | Interactive elements under 24×24px — or 44×44px with `{ strict: true }` (2.5.5, AAA) |
| `focus-indicator` | 2.4.7 (AA) | `focus:outline-none` with no visible replacement |
| `focus-contrast` | 1.4.11 (AA) | A present `outline-*`/`ring-*` focus indicator below 3:1 contrast — or also below the 2px minimum thickness with `{ strict: true }` (2.4.13, AAA) |
| `reduced-motion` | 2.3.3 (AAA-only) | A `hover:`/`focus:`/`focus-visible:`/`active:`-scoped `scale-*`/`rotate-*`/`translate-*`/`skew-*` change with an unscoped `transition`/`transition-all`/`transition-transform` and no `motion-reduce:`/`motion-safe:` handling — **not** included in `configs.recommended`, see below |

Exact scope and known limitations: [engine README](https://github.com/chamroro/tailwind-a11y/tree/main/packages/tailwind-a11y#scope).

## Custom theme

A `tailwind.config.js`/`.cjs`/`.mjs` (Tailwind v3) or a CSS `@theme` file like
`app/globals.css` (Tailwind v4) in ESLint's cwd is auto-detected; point at a specific
file instead via `settings`:

```js
export default [
  ...tailwindA11y.configs.recommended,
  { settings: { "tailwind-a11y": { configPath: "./tailwind.config.cjs" } } },
];
```

## Stricter (AAA) mode

`touch-target` and `focus-contrast` each default to their AA tier. Pass
`{ strict: true }` as each rule's own option to hold it to its AAA tier
instead — `touch-target` to 2.5.5 (44×44px), `focus-contrast` to also
require 2.4.13's minimum indicator thickness on top of its always-on 3:1
contrast check. Each rule's `strict` option is independent — there's no
single flag that turns both on at once in ESLint, unlike the CLI/VS
Code/GitHub Action, which do share one:

```js
export default [
  {
    files: ["**/*.jsx", "**/*.tsx"],
    plugins: { "tailwind-a11y": tailwindA11y },
    rules: {
      "tailwind-a11y/touch-target": ["warn", { strict: true }],
      "tailwind-a11y/focus-contrast": ["warn", { strict: true }],
    },
  },
];
```

## Reduced motion (AAA-only, opt-in)

`reduced-motion` has no AA tier to fall back to, so it isn't part of
`configs.recommended` the way the other three rules are — enable it
explicitly if you want it:

```js
export default [
  ...tailwindA11y.configs.recommended,
  {
    files: ["**/*.jsx", "**/*.tsx"],
    plugins: { "tailwind-a11y": tailwindA11y },
    rules: { "tailwind-a11y/reduced-motion": "warn" },
  },
];
```

No `strict` option here (unlike `touch-target`/`focus-contrast`) — enabling
the rule at all is already the opt-in gesture.

## Notes

`.tsx` files need a TypeScript-aware `languageOptions.parser` (e.g. `typescript-eslint`)
in your own config for ESLint to parse them at all. This plugin's own analysis
understands TypeScript syntax regardless — but ESLint has to parse the file successfully
before any rule, including this one, ever runs.

## License

MIT
