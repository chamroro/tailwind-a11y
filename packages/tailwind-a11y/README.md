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
npx tailwind-a11y                    # scans **/*.{jsx,tsx}
npx tailwind-a11y "src/**/*.tsx"     # custom glob
npx tailwind-a11y --verbose          # also reports what couldn't be checked, and why
npx tailwind-a11y --version          # print the installed version
npx tailwind-a11y --help             # usage and all options
```

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
| Contrast | 1.4.3 (AA) | `text-*`/`bg-*` pairs below 4.5:1, same-element or direct-parent; suggests the nearest passing shade |
| Touch target | 2.5.8 (AA) | Interactive elements under 24×24px |
| Focus indicator | 2.4.7 (AA) | `focus:outline-none` with no visible replacement |

## Scope

When a case can't be resolved with confidence, it's skipped rather than guessed:

- Ancestors beyond the immediate parent, or backgrounds set inside a separate component
- Dynamic or computed `className` (ternaries, `clsx()`, template literals)
- Custom theme colors/spacing not in Tailwind's default scales
- Color + opacity shorthand (`bg-white/50`)
- Frameworks other than React/JSX

`--verbose` reports what was skipped and why — a skip is not a pass. Full rationale in
[CLAUDE.md](./CLAUDE.md).

## Related

- [`eslint-plugin-tailwind-a11y`](https://github.com/chamroro/tailwind-a11y/tree/main/packages/eslint-plugin-tailwind-a11y) — same checks as ESLint rules
- [`vscode-tailwind-a11y`](https://github.com/chamroro/tailwind-a11y/tree/main/packages/vscode-tailwind-a11y) — same checks as live editor diagnostics

## License

MIT
