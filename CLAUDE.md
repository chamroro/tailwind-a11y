# tailwind-a11y (monorepo root)

npm workspaces monorepo with three packages. Per-package conventions, scope boundaries,
and architecture live in each package's own `CLAUDE.md` — this file covers only
monorepo-level rules.

```
packages/
  tailwind-a11y/                  the engine + CLI — see packages/tailwind-a11y/CLAUDE.md
  eslint-plugin-tailwind-a11y/    thin ESLint adapter over the engine
  vscode-tailwind-a11y/           thin VS Code adapter over the engine (live diagnostics)
```

All three adapters call the engine's `extract*`/`check*` functions directly —
none of them reimplement detection logic. Adding a fourth adapter (or a
fourth check) should follow the same pattern.

## Rules specific to the monorepo layout

- **`workspaces` in the root `package.json` is an explicit ordered array, not a
  `packages/*` glob.** Glob matches resolve alphabetically, which would build/test
  `eslint-plugin-tailwind-a11y` before `tailwind-a11y` — and the plugin imports types
  from the engine's build output, so that order fails. When adding a package, append it
  in dependency order.
- **`eslint-plugin-tailwind-a11y`'s dependency on `tailwind-a11y` is a plain semver range
  (`^0.1.0`), not a special workspace protocol** — npm has no `workspace:` protocol.
  npm resolves it to the local workspace symlink only while the range is satisfied by
  the engine's actual `version`. Bump both together; `npm run check:link` at the root
  guards against this drifting silently (a version bump that breaks the range makes npm
  silently fall back to the registry instead of local source — no error, just stale
  behavior).
- **One lockfile, at the root.** Never commit a `package-lock.json` inside a package
  directory.
- **Publish order: engine, then plugin, always** — the plugin's published manifest
  depends on the engine actually being on the registry.
- **Root `package.json` name is `tailwind-a11y-monorepo`, not `tailwind-a11y`** —
  deliberately different from the `packages/tailwind-a11y` package name to avoid a
  workspace name collision. Root is `"private": true` and never published.
- **`vscode-tailwind-a11y` must bundle its dependencies (esbuild) and package with
  `vsce package --no-dependencies`.** `vsce`'s dependency collector only looks inside
  the extension's own directory; npm workspaces hoists everything (including
  `tailwind-a11y` itself) to the monorepo root, so an unbundled build produces a
  `.vsix` with broken `../..` paths or missing deps. A raw `tsc` build here is broken,
  not just non-optimal.

## Working conventions (inherited from the engine package, apply repo-wide)

- Plan non-trivial multi-file changes before implementing (Plan Mode) — spec-first, not
  ad-hoc.
- Get an independent review pass (subagent) after a module/package lands, before
  considering it done.
- No comments unless they explain a non-obvious *why*. Never restate what the code says.
