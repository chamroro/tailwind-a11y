# tailwind-a11y

A monorepo for a static analysis engine that resolves Tailwind CSS utility classes back
into their real computed values (colors, sizes, focus behavior) — so WCAG accessibility
bugs can be caught before rendering, instead of at a Lighthouse audit or QA pass after
the fact.

## Packages

| Package | What it is |
|---|---|
| [`tailwind-a11y`](./packages/tailwind-a11y) | The engine + CLI. `npx tailwind-a11y` scans your project. |
| [`eslint-plugin-tailwind-a11y`](./packages/eslint-plugin-tailwind-a11y) | The same checks as ESLint rules, for inline feedback during normal linting. |
| [`vscode-tailwind-a11y`](./packages/vscode-tailwind-a11y) | The same checks as live editor diagnostics, as you type in `.jsx`/`.tsx` files. |

All three ship the same three checks — color contrast (WCAG 1.4.3), touch target size
(WCAG 2.5.8), and focus indicator removal (WCAG 2.4.7) — and will never disagree with
each other, since the ESLint plugin and VS Code extension are thin adapters over the
engine, not separate implementations. See each package's own README for install/usage
and exact scope.

## Development

npm workspaces, three packages, no extra tooling (no Turborepo/Nx/Changesets — not
warranted at this size):

```bash
npm install                          # from repo root — installs and links both packages
npm run build --workspaces           # builds tailwind-a11y first, then the plugin (order matters, see below)
npm test --workspaces --if-present
```

On a fresh clone, run `npm install` once more after the first `npm run build --workspaces`
— the `tailwind-a11y` CLI's `node_modules/.bin` symlink is only created for a target
(`dist/cli.js`) that already exists at install time, so the very first install predates it.

**Version lockstep**: `eslint-plugin-tailwind-a11y` depends on `tailwind-a11y` via a
plain semver range (`^0.1.0`), resolved to the local workspace as long as that range is
satisfied by `packages/tailwind-a11y`'s actual `version`. Bumping the engine's version
past that range without updating the plugin's dependency makes npm silently fall back to
fetching a real package from the registry instead of using local source. After bumping
either version, run `npm install && npm run check:link` to confirm the workspace link is
still intact.

**Adding a package**: append it to the root `package.json`'s `workspaces` array in
dependency order — it's an explicit ordered list (not a `packages/*` glob) specifically
so build/test scripts run engine-before-plugin; a glob would resolve alphabetically and
build the plugin first.

**Publishing**: engine first, always (`npm publish -w tailwind-a11y --access public`),
then the plugin, only once the engine is live on the registry. The VS Code extension
publishes separately, to the Marketplace rather than npm (`npm run package -w
vscode-tailwind-a11y`, then `vsce publish` — see that package's README).

## License

MIT
