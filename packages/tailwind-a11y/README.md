# tailwind-a11y

CLI that catches WCAG accessibility violations in Tailwind CSS class combinations
before they ship.

Resolves Tailwind utility classes into their real computed values via AST analysis,
rather than matching class names. This catches a pattern most contrast checkers miss —
background color on a parent element, text color on a child:

```jsx
<div className="bg-white">
  <p className="text-gray-400">not caught by most tools — but fails WCAG AA</p>
</div>
```

## Install

```bash
npm install --save-dev tailwind-a11y
```

## Usage

```bash
npx tailwind-a11y                              # scans **/*.{jsx,tsx}
npx tailwind-a11y "src/**/*.tsx"               # custom glob
npx tailwind-a11y --verbose                    # also reports what couldn't be checked, and why
npx tailwind-a11y --strict                     # AAA tier: touch targets 2.5.5, focus indicators also 2.4.13, and enables the reduced-motion check (2.3.3)
npx tailwind-a11y --config ./tw.config.cjs     # use a specific config instead of auto-detecting
npx tailwind-a11y --version                    # print the installed version
npx tailwind-a11y --help                       # usage and all options
```

Custom theme colors/spacing are read automatically, so colors and spacing outside
Tailwind's defaults resolve too — not just the built-in palette. Both config formats
are supported: `theme.extend.colors`/`theme.extend.spacing` in a Tailwind v3
`tailwind.config.js`/`.cjs`, and `--color-*`/`--spacing-*` custom properties in a
Tailwind v4 CSS `@theme { ... }` block (auto-detected from common paths like
`app/globals.css`, or passed via `--config`).

```
src/components/Card.tsx
  3: text-gray-400 on bg-white — ratio 2.54, needs 4.5 (AA); try text-gray-500 (4.83)
src/components/IconButton.tsx
  5: <button> is 16×16px (w-4 h-4) — WCAG 2.5.8 requires >= 24×24px

2 issue(s) in 2 file(s)
```

Exits `1` on violations — safe to use as a CI gate.

## Checks

| Check | WCAG | Detects |
|---|---|---|
| Contrast | 1.4.3 (AA) | `text-*`/`bg-*` pairs below 4.5:1, same-element or direct-parent, including a text-side opacity modifier (`text-gray-400/50`) composited against the background; suggests the nearest passing shade |
| Touch target | 2.5.8 (AA) | Interactive elements under 24×24px — or 44×44px with `--strict` (2.5.5, AAA) |
| Focus indicator | 2.4.7 (AA) | `focus:outline-none` with no visible replacement |
| Focus indicator contrast | 1.4.11 (AA) | A present `outline-*`/`ring-*` focus indicator below 3:1 contrast — or also below the 2px minimum thickness with `--strict` (2.4.13, AAA) |
| Reduced motion | 2.3.3 (AAA, `--strict` only) | A `hover:`/`focus:`/`focus-visible:`/`active:`-scoped `scale-*`/`rotate-*`/`translate-*`/`skew-*` change with an unscoped `transition`/`transition-all`/`transition-transform` and no `motion-reduce:`/`motion-safe:` handling |

## Scope

When a case can't be resolved with confidence, it's skipped rather than guessed:

- Ancestors beyond the immediate parent, or backgrounds set inside a separate component
- Dynamic or computed `className` (ternaries, `clsx()`, template literals)
- A full `theme.colors`/`theme.spacing` replacement, `.mjs`/`.ts` configs, or
  Tailwind v4's CSS-based `@theme` config (only `theme.extend` in a `.js`/`.cjs`
  config is read — see [CLAUDE.md](./CLAUDE.md))
- Opacity shorthand on the **background** side (`bg-white/50` as the actual
  background) — the rendered backdrop is layout-dependent and out of scope,
  same reasoning as the ancestor-parent limit above. **Text-side** opacity
  (`text-gray-400/50`) *is* resolved, composited against the (opaque) background.
- Frameworks other than React/JSX

`--verbose` reports what was skipped and why — a skip is not a pass. Full rationale in
[CLAUDE.md](./CLAUDE.md).

## Related

- [`eslint-plugin-tailwind-a11y`](https://github.com/chamroro/tailwind-a11y/tree/main/packages/eslint-plugin-tailwind-a11y) — same checks as ESLint rules
- [`vscode-tailwind-a11y`](https://github.com/chamroro/tailwind-a11y/tree/main/packages/vscode-tailwind-a11y) — same checks as live editor diagnostics
- [`github-action-tailwind-a11y`](https://github.com/chamroro/tailwind-a11y/tree/main/packages/github-action-tailwind-a11y) — same checks as inline PR annotations

## License

MIT
