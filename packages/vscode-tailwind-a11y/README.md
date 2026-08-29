# Tailwind a11y

Live WCAG diagnostics for Tailwind CSS, in the editor — the same checks as
[`tailwind-a11y`](https://github.com/chamroro/tailwind-a11y/tree/main/packages/tailwind-a11y),
its [ESLint plugin](https://github.com/chamroro/tailwind-a11y/tree/main/packages/eslint-plugin-tailwind-a11y),
and its [GitHub Action](https://github.com/chamroro/tailwind-a11y/tree/main/packages/github-action-tailwind-a11y),
all powered by the same engine. Results never disagree between them — no detection logic is
reimplemented here.

## What it shows

| Check | WCAG | Detects |
|---|---|---|
| Contrast | 1.4.3 (AA) | Low-contrast `text-*`/`bg-*` pairs — with a suggested nearby shade |
| Touch target | 2.5.8 (AA) | Interactive elements under 24×24px — or 44×44px with `tailwind-a11y.strict` (2.5.5, AAA) |
| Focus indicator | 2.4.7 (AA) | `focus:outline-none` with no visible replacement |
| Focus indicator contrast | 1.4.11 (AA) | A present `outline-*`/`ring-*` focus indicator below 3:1 contrast — or also below the 2px minimum thickness with `tailwind-a11y.strict` (2.4.13, AAA) |
| Reduced motion | 2.3.3 (AAA-only, `tailwind-a11y.strict` only) | A `hover:`/`focus:`/`focus-visible:`/`active:`-scoped `scale-*`/`rotate-*`/`translate-*`/`skew-*` change with an unscoped `transition`/`transition-all`/`transition-transform` and no `motion-reduce:`/`motion-safe:` handling |

Diagnostics appear as warnings in `.jsx`/`.tsx` files, updating on open, save, and
(debounced) as you type. For CI enforcement, use the [CLI](https://github.com/chamroro/tailwind-a11y/tree/main/packages/tailwind-a11y)
or [ESLint plugin](https://github.com/chamroro/tailwind-a11y/tree/main/packages/eslint-plugin-tailwind-a11y)
instead — both treat the same findings as errors.

A `tailwind.config.js`/`.cjs`/`.mjs` (Tailwind v3) or a CSS `@theme` file like
`app/globals.css` (Tailwind v4) in the open file's workspace folder is picked up
automatically, so custom theme colors/spacing resolve the same way they do in the CLI
and ESLint plugin. Editing a `.js`/`.cjs`/`.css` config is picked up live, same as
editing any other file — a `.mjs` config is the one exception: Node caches it in a
way this extension can't invalidate, so an edit to a `.mjs` config needs a window
reload (Developer: Reload Window) to take effect. Point at a specific file instead
via the `tailwind-a11y.configPath` setting:

```json
{ "tailwind-a11y.configPath": "./app/globals.css" }
```

Set `tailwind-a11y.strict` to enforce the stricter 44×44px touch target
minimum (WCAG 2.5.5, AAA) instead of the default 24×24px (2.5.8, AA), to
also require focus indicators to meet WCAG 2.4.13's minimum thickness
alongside the always-on 3:1 contrast check (1.4.11), and to enable the
reduced-motion check (WCAG 2.3.3, AAA-only, off unless `strict` is set —
there's no AA tier for it to fall back to):

```json
{ "tailwind-a11y.strict": true }
```

## License

MIT
