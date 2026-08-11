# Tailwind a11y

Live WCAG diagnostics for Tailwind CSS, in the editor — the same three checks as
[`tailwind-a11y`](https://github.com/chamroro/tailwind-a11y/tree/main/packages/tailwind-a11y)
and its [ESLint plugin](https://github.com/chamroro/tailwind-a11y/tree/main/packages/eslint-plugin-tailwind-a11y),
powered by the same engine. Results never disagree between them — no detection logic is
reimplemented here.

## What it shows

| Check | WCAG | Detects |
|---|---|---|
| Contrast | 1.4.3 (AA) | Low-contrast `text-*`/`bg-*` pairs — with a suggested nearby shade |
| Touch target | 2.5.8 (AA) | Interactive elements under 24×24px |
| Focus indicator | 2.4.7 (AA) | `focus:outline-none` with no visible replacement |

Diagnostics appear as warnings in `.jsx`/`.tsx` files, updating on open, save, and
(debounced) as you type. For CI enforcement, use the [CLI](https://github.com/chamroro/tailwind-a11y/tree/main/packages/tailwind-a11y)
or [ESLint plugin](https://github.com/chamroro/tailwind-a11y/tree/main/packages/eslint-plugin-tailwind-a11y)
instead — both treat the same findings as errors.

A `tailwind.config.js`/`.cjs` (Tailwind v3) or a CSS `@theme` file like
`app/globals.css` (Tailwind v4) in the open file's workspace folder is picked up
automatically, so custom theme colors/spacing resolve the same way they do in the CLI
and ESLint plugin.

## License

MIT
