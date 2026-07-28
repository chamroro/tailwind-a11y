# vscode-tailwind-a11y

Inline [WCAG](https://www.w3.org/WAI/WCAG21/quickref/) diagnostics for Tailwind CSS class
combinations, right in the editor — color contrast, touch target size, and focus indicator
removal, as you type in `.jsx`/`.tsx` files.

This extension is a thin adapter over the [`tailwind-a11y`](https://github.com/chamroro/tailwind-a11y/tree/main/packages/tailwind-a11y)
engine — the same one the CLI and [ESLint plugin](https://github.com/chamroro/tailwind-a11y/tree/main/packages/eslint-plugin-tailwind-a11y)
use. No detection logic is reimplemented here, so the squiggly underline you see in the
editor will never disagree with what `npx tailwind-a11y` or `eslint` report for the same
code.

## What it catches

- **Contrast** (WCAG 1.4.3) — including a suggested nearby shade that would pass, when one
  exists in the same color scale, e.g. `text-gray-400 on bg-white — ratio 2.54, needs 4.5
  (AA); try text-gray-500 (4.83)`
- **Touch target size** (WCAG 2.5.8) — interactive elements under 24×24px
- **Focus indicator removal** (WCAG 2.4.7) — `focus:outline-none` with no visible replacement

Diagnostics show as warnings (not errors) — a squiggly underline in an editor reads as a
compile failure otherwise. For CI gating, use the CLI or ESLint plugin instead, which treat
the same findings as errors.

Re-analysis runs on file open, file save, and (debounced ~300ms) as you type. Each
finding's exact scope and known limitations are documented in the
[engine's README](https://github.com/chamroro/tailwind-a11y/tree/main/packages/tailwind-a11y#what-it-deliberately-doesnt-catch-v1-scope).

## Development

This package lives in the [`tailwind-a11y` monorepo](https://github.com/chamroro/tailwind-a11y)
(npm workspaces):

```bash
npm install                          # from the monorepo root
npm run build -w tailwind-a11y       # engine must be built first — this extension
                                      # bundles its dist/, not its src/
npm run build -w vscode-tailwind-a11y
```

Then press F5 in VS Code (with this package open) to launch an Extension Development Host
and try it against a `.tsx` file.

### Packaging

This extension **must** be bundled (esbuild) rather than shipped as raw compiled output —
in this monorepo, `vsce`'s dependency collector only looks inside this package's own
directory, and npm workspaces hoists all dependencies (including `tailwind-a11y` itself) to
the monorepo root. An unbundled build would produce a `.vsix` with broken paths.

```bash
npm run package -w vscode-tailwind-a11y   # vsce package --no-dependencies
```

### Publishing

Requires a [Visual Studio Marketplace publisher](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#create-a-publisher)
identity and an Azure DevOps personal access token — both manual, account-bound setup
steps, not part of this repo. Set `publisher` in `package.json` before packaging for real.

## License

MIT
