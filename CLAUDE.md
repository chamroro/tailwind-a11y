# tailwind-a11y (monorepo root)

npm workspaces monorepo with four packages. Per-package conventions, scope boundaries,
and architecture live in each package's own `CLAUDE.md` — this file covers only
monorepo-level rules.

```
packages/
  tailwind-a11y/                  the engine + CLI — see packages/tailwind-a11y/CLAUDE.md
  eslint-plugin-tailwind-a11y/    thin ESLint adapter over the engine
  vscode-tailwind-a11y/           thin VS Code adapter over the engine (live diagnostics)
  github-action-tailwind-a11y/    thin GitHub Action adapter (inline PR annotations);
                                   its manifest is the root-level action.yml so consumers
                                   can write `uses: chamroro/tailwind-a11y@v0`
```

All adapters call the engine's `extract*`/`check*` functions directly —
none of them reimplement detection logic. Adding another adapter (or
another check) should follow the same pattern.

## Rules specific to the monorepo layout

- **`workspaces` in the root `package.json` is an explicit ordered array, not a
  `packages/*` glob.** Glob matches resolve alphabetically, which would build/test
  `eslint-plugin-tailwind-a11y` before `tailwind-a11y` — and the plugin imports types
  from the engine's build output, so that order fails. When adding a package, append it
  in dependency order.
- **`eslint-plugin-tailwind-a11y`'s dependency on `tailwind-a11y` is a plain semver range
  (`^0.10.0`), not a special workspace protocol** — npm has no `workspace:` protocol.
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
- **A fix to the engine's detection logic requires bumping `vscode-tailwind-a11y`'s own
  version too, even when its source didn't change.** `eslint-plugin-tailwind-a11y`
  resolves `tailwind-a11y` dynamically from `node_modules` at each consumer's install,
  so a new engine patch reaches it automatically without a plugin republish. But because
  `vscode-tailwind-a11y` bundles the engine into a static `.vsix` at build time, there is
  no dependency resolution happening on the end user's machine — a bug fix to the engine
  is frozen out of every Marketplace install until the extension itself is rebuilt and
  republished with a bumped version. The same applies to `github-action-tailwind-a11y`
  (also a bundle — see below).
- **`packages/github-action-tailwind-a11y/dist/index.js` is a COMMITTED build
  artifact** — the only dist in this repo that is (`.gitignore` re-includes that one
  directory). GitHub runs a JS action straight from the repo tree at a git ref with no
  npm install, so the bundle IS the release artifact; there is no publish step to force
  a rebuild. After any engine change, rebuild and commit it
  (`npm run build -w tailwind-a11y && npm run build -w github-action-tailwind-a11y`).
  `.github/workflows/verify-action-bundle.yml` enforces this on every PR and push to
  main by rebuilding and failing on `git diff` (deliberately no paths filter — a
  lockfile-only bump changes bundle bytes without touching any filterable path). The
  bundle build keeps `minify: false, sourcemap: false` so rebuilds are reproducible
  given the lockfile-pinned esbuild.
- **Bundled adapters must not rely on `import.meta`** — esbuild's CJS output rewrites
  `import.meta` to an empty object, so e.g. `createRequire(import.meta.url)` throws
  inside a bundle (and if wrapped in try/catch, degrades silently — this shipped as a
  real bug in vscode-tailwind-a11y 0.5.0, where custom-theme detection silently never
  worked). The engine's `loadCustomTheme` anchors `createRequire` to the config path
  itself instead; a bundling regression test in `loadCustomTheme.test.ts` builds a real
  CJS bundle and runs it.
- **Tag namespaces**: bare `vX.Y.Z` tags are the engine's releases. The GitHub Action
  releases via a floating `v0` tag (what consumers pin) plus an immutable
  `action-vX.Y.Z` tag, both handled by publish.yml's `release-action` job (gated
  on the action package's own version bump, like every other package). Never tag an
  action release as bare `vX.Y.Z`. Unlike `v0` (deliberately force-moved every
  release), `action-vX.Y.Z` is pushed *without* `-f` and the job fails first if that
  tag already exists on origin — npm/vsce reject a duplicate version automatically,
  but git has no such built-in check, so this job does it explicitly rather than
  letting an "immutable" tag silently move.
- **Why the Action is a bundled JS action, not a composite running `npx tailwind-a11y`**:
  a composite gets no structured violation objects (so no inline annotations, the whole
  point) and pays npm-install latency per CI run.
- **`.github/workflows/publish.yml` auto-publishes on push to `main`, gated per-package
  by whether that package's `version` field actually changed in the push.** A version
  bump landing via a merged PR is what triggers a real publish — don't bump a version
  casually in an unrelated PR. Every publish job targets the `release` GitHub
  Environment (required reviewer approval gate before the actual publish step runs) and
  needs `NPM_TOKEN` (npm Automation token, not a regular one — regular tokens require a
  2FA OTP that CI can't provide) and `VSCE_PAT` set as secrets on that environment.
  One-time setup: repo Settings → Environments → New environment named `release` →
  enable Required reviewers → add the two secrets there (not the repo-level secrets
  page). `NPM_TOKEN` comes from npmjs.com → Access Tokens → Generate New Token →
  Automation; `VSCE_PAT` is the same Azure DevOps PAT used for manual `vsce publish`
  (Marketplace → Manage scope, "All accessible organizations").
- **On a fresh clone, `npm install` runs twice**: once before the first
  `npm run build --workspaces` (to get the toolchain), once after (so the
  `tailwind-a11y` CLI's `node_modules/.bin` symlink gets created — it's only linked for
  a `dist/cli.js` that already exists at install time).

## Working conventions (inherited from the engine package, apply repo-wide)

- Plan non-trivial multi-file changes before implementing (Plan Mode) — spec-first, not
  ad-hoc.
- Get an independent review pass (subagent) after a module/package lands, before
  considering it done.
- No comments unless they explain a non-obvious *why*. Never restate what the code says.
