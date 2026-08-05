# tailwind-a11y

(Renamed from `tailwind-contrast-guard` once a second and third check were
added. Later, the GitHub repo itself was also renamed to `tailwind-a11y` and
restructured as an npm workspaces monorepo — this package now lives at
`packages/tailwind-a11y/` alongside `packages/eslint-plugin-tailwind-a11y/`.
See the monorepo root `CLAUDE.md` for workspace-level conventions. Published
to npm since 0.1.0, so changes here now carry real back-compat weight for
published consumers, not free pre-launch churn.)

## What this is

A static analysis CLI that catches WCAG accessibility violations in Tailwind
CSS class combinations before they ship: color contrast, touch target size,
and focus indicator removal. Existing contrast tools (e.g.
`tailwindcss-contrast-checker`) only catch `text-*`/`bg-*` on the *same*
element; this tool also catches the much more common **direct-parent**
pattern:

```jsx
<div className="bg-white">
  <p className="text-gray-400">low contrast, but not on the same element</p>
</div>
```

The touch-target and focus-indicator checks were added because they fit the
exact same architecture (token resolution + threshold/presence comparison)
and are not already covered well by existing tools like
`eslint-plugin-jsx-a11y` (which handles semantic/ARIA concerns, not
Tailwind-class-level sizing or focus-style analysis).

## Scope (v1) — read before adding features

- **React/JSX only.** No Vue, Svelte, or Blade template support. If asked to
  add another framework, that's a new parser adapter, not a change to this
  one — don't generalize the JSX parser to try to handle multiple syntaxes.
- **Contrast: same-element + direct-parent only.** Do not walk further up
  the ancestor chain, and do not attempt to resolve backgrounds set by a
  wrapping component defined in another file (e.g. `<Card><Text/></Card>`
  where `Card` sets `bg-white` internally). That's a whole-program,
  type-aware analysis problem — explicitly out of scope. Known limitation,
  not a bug to fix.
- **Static `className` string literals only.** Ternaries, `clsx`/`cva`
  composition, and computed class names are not resolved. Skip them silently
  rather than guessing.
- **CLI + CI first, editor integration lives in a separate adapter.**
  `packages/vscode-tailwind-a11y` now exists as a third adapter over this
  engine (alongside the ESLint plugin) — it does not change this package's
  own scope, it just reuses `extractChecks`/`checkContrast` etc. directly.
- **Custom `tailwind.config.js`/`.cjs` theme extension *is* implemented** (see
  `theme/loadCustomTheme.ts`), but narrowly:
  - Reads only `theme.extend.colors`/`theme.extend.spacing` — never a full
    `theme.colors`/`theme.spacing` replacement.
  - `.js`/`.cjs` only. No `.mjs`/`.ts` config files (no config-transpiling
    dependency exists in this package, and none is being added just for
    this). A `.js` config inside a `"type": "module"` project throws
    `ERR_REQUIRE_ESM` on `require()` — caught, treated the same as "no
    config found," not a crash.
  - Tailwind v4's CSS-first `@theme` config is not read at all.
  - No ancestor-directory search — only the given root dir is checked.
    `--config` (CLI) / `settings["tailwind-a11y"].configPath` (ESLint) exist
    as explicit overrides.
  - Per color entry: only a plain object of hex-string shades is accepted
    (validated with the existing `hexToRgb`). A flat string color
    (`colors: { brand: '#3490dc' }`) or a `DEFAULT` key is skipped — no
    class syntax (`bg-brand-DEFAULT` isn't real Tailwind) would ever resolve
    to it.
  - Per spacing entry: only `rem`/`px` string values are accepted (rem × 16,
    matching `spacingScale.ts`'s own 16px-root assumption).
  - `semanticColors` (`white`/`black`/`transparent`/etc.) stays hardcoded,
    not re-themeable.
  - Running this tool now executes the target project's `tailwind.config.js`
    as a side effect of scanning (same as ESLint/Jest/webpack/PostCSS
    already do with their own configs) — previously this tool only ever
    parsed JSX via Babel, never executed anything.
- **Touch target: no `min-w-*`/`min-h-*` fallback.** A minimum-width utility
  only guarantees a floor, not the actual rendered size — using it would
  mean guessing, so elements without explicit `w-*`+`h-*` are skipped
  entirely rather than approximated. The WCAG 2.5.8 "Inline" exception
  (targets inside a sentence/text block are exempt) *is* implemented — see
  `isInlineInText()` in `parser/extractTouchTargets.ts`. It only recognizes
  a literal `JSXText` sibling immediately before/after the target — text
  delivered via `{"..."}` or a conditionally-rendered wrapper isn't detected,
  so those inline links are still (conservatively) flagged. Under-exempting
  is the safe direction here; the reverse — over-exempting based on text
  anywhere in the parent rather than adjacent to the target — was caught in
  review as the same shape-not-meaning failure class noted below, just at
  the sibling level instead of the token level.
- **Focus indicator: `focus:` and `focus-visible:` are merged** for the
  removal-vs-replacement comparison, since the standard accessible pattern
  (`focus:outline-none focus-visible:ring-2`) spans both variants.
- **Contrast: opacity modifiers (`text-gray-400/50`) are resolved on the
  *text* side only**, composited against the already-resolved (fully opaque)
  background — see `resolveTextColorWithOpacity()`/`applyAlpha()` in
  `rules/checkContrast.ts`/`contrast/luminance.ts`. Deliberate cuts:
  - The *background* side (`bg-white/50` as the actual background) stays
    unresolvable. Compositing it correctly requires knowing what's rendered
    behind it (grandparent-or-beyond) — the same ancestor-walk this file
    already scopes out for plain (non-opacity) backgrounds.
  - `scale-shade/NN` (`text-gray-400/50`), semantic-word/NN (`text-white/50`,
    `text-black/50`), and arbitrary-hex/NN (`text-[#eee]/50`) all resolve —
    `COLOR_TOKEN` in `extractClasses.ts` extracts all three shapes with the
    opacity suffix intact. (`text-white/NN`/`text-black/NN` specifically was
    a real gap caught in review: the extraction regex initially only kept the
    suffix on the scale-shade shape, silently dropping the semantic/arbitrary
    cases with no `--verbose` trace at all — arguably the *more* common real
    idiom than named-scale opacity, so leaving it out would have undercut
    this feature's whole point.)
  - Only a plain 0–100 integer percentage. An arbitrary bracket alpha
    (`/[0.15]`) falls through unresolved.
  - An out-of-range percentage (`/150`) is **clamped** to 0–100, not rejected
    — real browsers clamp out-of-range CSS alpha the same way, so this
    matches actual rendering rather than guessing. Rejecting it instead would
    hide a real violation behind what's essentially a typo — the "shape looks
    safe but isn't" failure class noted below.
  - Exactly 0% (`/0`) is treated as unresolvable, like `text-transparent`
    (`semanticColors.transparent` is already `null`) — not flagged as an
    unconditional violation, since fully-invisible text isn't a contrast
    problem in the same sense a merely-faint one is.

These boundaries exist because the cross-component, dynamic-class, and
whole-DOM-layout cases require whole-program or runtime analysis — a
fundamentally different (and much heavier) tool. Keeping v1 to statically
resolvable, same-element-or-direct-parent cases covers most real-world
issues at a fraction of the engineering cost.

## Architecture

```
src/
  theme/defaultPalette.ts         — Tailwind default color name -> hex map
  theme/spacingScale.ts           — Tailwind default spacing scale -> px map
  theme/loadCustomTheme.ts        — finds/loads a project's tailwind.config.js/.cjs,
                                     merges theme.extend.colors/spacing over the
                                     defaults (resolveTheme() is the one function
                                     each adapter calls)
  contrast/luminance.ts           — WCAG relative luminance + contrast ratio math
  parser/babelInterop.ts          — shared @babel/traverse CJS/ESM interop shim,
                                     parseJSX(), getStaticClassName()
  parser/isInteractiveElement.ts  — shared "is this element interactive" predicate
  parser/extractClasses.ts        — text-*/bg-* pairs per element (contrast)
  parser/extractTouchTargets.ts   — w-*/h-* pairs on interactive elements
  parser/extractFocusIndicators.ts— focus:/focus-visible: classes on interactive elements
  rules/checkContrast.ts          — contrast violations (WCAG 1.4.3, AA);
                                     resolves a text-side opacity modifier
                                     against the resolved (opaque) bg; also
                                     suggestContrastFix() — nearest passing
                                     shade in the same color scale (text side
                                     only, bg and any opacity held fixed)
  rules/checkTouchTarget.ts       — touch target violations (WCAG 2.5.8, AA)
  rules/checkFocusIndicator.ts    — focus indicator violations (WCAG 2.4.7, AA)
  cli.ts                         — fast-glob scan, run all three checkers,
                                    print report, exit 1 on any violations (CI)
  cliArgs.ts                     — flag parsing, including --config <path>
```

Each check gets its **own independent Babel parse+traverse pass** over a
file (not a shared visitor) — this is a lint tool, not a hot path, and
independent passes mean a bug in one check can't destabilize another.
Only the traversal *interop shim* and the *interactive-element predicate*
are shared (see `parser/babelInterop.ts`, `parser/isInteractiveElement.ts`)
— duplicating either of those across checks would be exactly the kind of
drift risk that caused a real bug once (see the `opacity-*`/`ring-0`-style
false-negative note below).

## A real bug pattern to watch for in new regex/token-matching code

A `COLOR_TOKEN` regex once false-positived on `bg-opacity-50` (same
"word-number" shape as a color token), and because extraction used
"last-token-wins", it silently overwrote real color matches — a real
violation vanished. The same shape of bug was proactively guarded against in
the touch-target check (`hover:w-24` must not overwrite a real `w-4`) and
the focus-indicator check (`focus:ring-0`/`border-0`/`shadow-none`/
`bg-transparent` are explicitly denylisted as degenerate non-replacements).
**Any new class-matching logic should ask: is there a same-shape decoy token
that could mask a real violation?** — and add a regression test for it if so.

## Stack

TypeScript (strict mode), ESM, `@babel/parser`/`@babel/traverse` for JSX AST,
`fast-glob` for file discovery, `vitest` for tests, `tsx` for local dev runs.

## Working conventions

- Plan new modules before implementing (use Plan Mode) — this project is
  built spec-first, not by ad-hoc prompting.
- Get an independent review pass (subagent or `/code-review`) after each
  module lands, before moving to the next.
- No comments unless they explain a non-obvious *why* (a WCAG formula detail,
  a deliberate scope cut). Never restate what the code already says.
- Don't add support for cases explicitly listed as out-of-scope above without
  discussing it first — the narrow scope is a deliberate choice, not an
  oversight.
