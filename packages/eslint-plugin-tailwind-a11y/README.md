# eslint-plugin-tailwind-a11y

ESLint rules that catch [WCAG](https://www.w3.org/WAI/WCAG21/quickref/) accessibility
violations in Tailwind CSS class combinations — color contrast, touch target size, and
focus indicator removal — as part of your normal `eslint` run, instead of a separate CLI
you have to remember to invoke.

This plugin is a thin ESLint adapter over the [`tailwind-a11y`](https://github.com/chamroro/tailwind-a11y/tree/main/packages/tailwind-a11y)
engine, which does the actual work: resolving Tailwind utility classes back into real
computed values (colors, sizes) via AST analysis. Every rule here calls straight into
that engine and reports its violations — there's no separate implementation to drift out
of sync, and no wording that differs between `npx tailwind-a11y` and `eslint .`.

## Install

```bash
npm install --save-dev eslint-plugin-tailwind-a11y
```

Requires ESLint 9 or 10 (flat config).

## Usage

```js
// eslint.config.js
import tailwindA11y from "eslint-plugin-tailwind-a11y";

export default [
  ...tailwindA11y.configs.recommended,
];
```

`configs.recommended` scopes itself to `**/*.jsx`/`**/*.tsx` and enables all three rules
as errors. To register rules manually instead:

```js
import tailwindA11y from "eslint-plugin-tailwind-a11y";

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

| Rule | WCAG | Catches |
|---|---|---|
| `tailwind-a11y/contrast` | 1.4.3 (AA) | `text-*`/`bg-*` pairs below the 4.5:1 contrast ratio, same-element or direct-parent |
| `tailwind-a11y/touch-target` | 2.5.8 (AA) | Interactive elements sized under 24×24px via `w-*`/`h-*` |
| `tailwind-a11y/focus-indicator` | 2.4.7 (AA) | `focus:outline-none` with no visible replacement style |

Each rule's exact scope and known limitations are documented in the
[engine's README](https://github.com/chamroro/tailwind-a11y/tree/main/packages/tailwind-a11y#what-it-deliberately-doesnt-catch-v1-scope) —
this plugin doesn't change what's checked, only how it's surfaced.

## `.tsx` files and parsers

The underlying engine parses each file's source independently with Babel (`jsx` +
`typescript` plugins), so `.tsx` syntax is understood regardless of what parser your
ESLint config uses. But ESLint itself still needs to parse the file *first* to run any
rule at all — if your config doesn't already set a TypeScript-aware
`languageOptions.parser` (e.g. `typescript-eslint`) for `.tsx` files, ESLint will fail to
parse them before this plugin ever runs. If you already lint `.tsx` files today, you have
this covered; nothing extra to add for this plugin specifically.

## Relationship to the `tailwind-a11y` CLI

Same checks, same engine, two ways to run them: `eslint-plugin-tailwind-a11y` for
inline, per-file feedback during normal linting; [`tailwind-a11y`](https://github.com/chamroro/tailwind-a11y/tree/main/packages/tailwind-a11y)
(the CLI) for a one-shot scan, e.g. in a CI step that doesn't otherwise run ESLint. Use
either, or both — they'll never disagree, since the plugin doesn't reimplement anything.

## Development

This package lives in the [`tailwind-a11y` monorepo](https://github.com/chamroro/tailwind-a11y)
(npm workspaces) alongside the engine it depends on:

```bash
npm install                              # from the monorepo root
npm run build --workspaces               # or: npm run build -w tailwind-a11y -w eslint-plugin-tailwind-a11y
npm test --workspaces --if-present
```

After changing the engine (`packages/tailwind-a11y`), rebuild it before running this
package's tests — the workspace dependency resolves through its `dist/`, not its `src/`.

## License

MIT
