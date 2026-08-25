# tailwind-a11y

Static analysis for Tailwind CSS accessibility. Resolves utility classes into their
real computed values — colors, sizes, focus behavior — to catch WCAG violations before
they ship, instead of at a Lighthouse audit or QA pass.

## Packages

| Package | Description |
|---|---|
| [`tailwind-a11y`](./packages/tailwind-a11y) | CLI and analysis engine |
| [`eslint-plugin-tailwind-a11y`](./packages/eslint-plugin-tailwind-a11y) | ESLint rules |
| [`vscode-tailwind-a11y`](./packages/vscode-tailwind-a11y) | Live editor diagnostics |
| [`github-action-tailwind-a11y`](./packages/github-action-tailwind-a11y) | Inline PR annotations (`uses: chamroro/tailwind-a11y@v0`) |

All four run the same five checks — color contrast (WCAG 1.4.3), touch target size
(WCAG 2.5.8, or 2.5.5 in strict mode), focus indicator removal (WCAG 2.4.7), focus
indicator contrast (WCAG 1.4.11, or also 2.4.13 in strict mode), and reduced motion for
interaction-triggered animation (WCAG 2.3.3, strict-mode only — no AA tier exists) —
through one shared engine, so results never disagree between them. See each package's
README for install and usage.

## Development

```bash
npm install
npm run build --workspaces
npm test --workspaces --if-present
```

npm workspaces, no extra tooling. Versioning, publishing, and CI/release setup are
documented in [CLAUDE.md](./CLAUDE.md).

## License

MIT
