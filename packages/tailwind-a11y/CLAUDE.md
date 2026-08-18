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
- **Custom theme extension *is* implemented for both Tailwind v3 JS configs
  and v4 CSS `@theme` configs** (see `theme/loadCustomTheme.ts` and
  `theme/parseThemeCss.ts`), but narrowly:
  - JS path: `tailwind.config.js`/`.cjs` only, reads only
    `theme.extend.colors`/`theme.extend.spacing` — never a full
    `theme.colors`/`theme.spacing` replacement. No `.mjs`/`.ts` config files
    (no config-transpiling dependency exists in this package, and none is
    being added just for this). A `.js` config inside a `"type": "module"`
    project throws `ERR_REQUIRE_ESM` on `require()` — caught, treated the
    same as "no config found," not a crash.
  - CSS path: reads `--color-{name}-{shade}`/`--spacing-{token}` custom
    properties out of `@theme { ... }` blocks (any modifier keyword, e.g.
    `@theme inline { ... }`, is accepted — the declaration syntax inside is
    identical). Auto-detection is a heuristic filename list (`app/globals.css`,
    `src/app/globals.css`, `styles/globals.css`, `src/styles/globals.css`,
    `src/index.css`, `globals.css` — most-specific first, since v4 has no
    single conventional filename the way v3 has `tailwind.config.js`). Does
    **not** follow `@import` statements to other CSS files — only `@theme`
    blocks physically present in the loaded file are read. A bare
    `--color-brand: #hex` (no shade suffix) or a bare `--spacing: <value>`
    (the v4 global spacing multiplier) is skipped — same "no class syntax to
    resolve it to" reasoning as the JS path's flat-string-color skip; the
    multiplier specifically would need derived-value math `spacingScale.ts`'s
    static token→px map doesn't do, a different feature.
  - When both a JS config and an auto-detectable CSS file exist, the JS
    config wins and the CSS file is never even checked — an existing
    JS-config project gets zero change in resolved output.
  - No ancestor-directory search — only the given root dir is checked (JS or
    CSS). `--config` (CLI) / `settings["tailwind-a11y"].configPath` (ESLint) /
    `INPUT_CONFIG` (GitHub Action) exist as explicit overrides, and accept
    either a `.js`/`.cjs` or a `.css` path.
  - Per color entry (both paths): only a plain hex-string value is accepted
    (validated with the existing `hexToRgb`) — CSS `oklch()`/`rgb()`/`hsl()`/
    `var()` etc. are skipped, same "not a hex value -- skip, don't guess"
    precedent, even though Tailwind v4's own ecosystem leans OKLCH for brand
    colors. A flat string color (`colors: { brand: '#3490dc' }`) or a
    `DEFAULT` key is skipped on the JS path — no class syntax
    (`bg-brand-DEFAULT` isn't real Tailwind) would ever resolve to it.
  - Per spacing entry (both paths): only `rem`/`px` string values are
    accepted (rem × 16, matching `spacingScale.ts`'s own 16px-root
    assumption).
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
- **Touch target: `checkTouchTargets(checks, strict?)` has two thresholds,
  both enforced by resolving against the same closed `spacingScale` lookup
  table** (see the "real bug pattern" section below for why that lookup-
  table design has no shape-not-meaning risk to begin with, regardless of
  which threshold is active): the default 24×24px is WCAG 2.5.8 (Level AA);
  opt-in `strict` raises it to WCAG **2.5.5** (Level AAA), 44×44px — verified
  against the W3C Understanding doc that 2.5.5 has the same "target in a
  sentence/text block" exemption as 2.5.8, so `isInlineInText()` above
  applies unchanged to both thresholds; this only changes the number being
  compared against, never how targets are found or exempted. Every adapter
  exposes it the same opt-in, default-off way: CLI `--strict`, ESLint
  `["error", { strict: true }]` rule option (the first rule option this
  plugin has ever needed — `configPath` deliberately lives in
  `settings["tailwind-a11y"]` instead, since it's cross-cutting across all
  three rules and `strict` isn't), VS Code `tailwind-a11y.strict` setting,
  GitHub Action `strict` input. `TouchTargetViolation` carries the active
  threshold on the violation itself now (`required: number`, `level: "AA" |
  "AAA"`), mirroring `ContrastViolation`'s existing shape — every formatter
  (`cli.ts`, the ESLint rule's message, `vscode-tailwind-a11y/src/format.ts`,
  `github-action-tailwind-a11y/src/annotations.ts`) reads this dynamically
  rather than hardcoding "WCAG 2.5.8"/"24×24px", which is what all four
  formatters did before `strict` existed (a real, if latent, bug — those
  strings would have been silently wrong for any consumer using a stricter
  threshold, so this was fixed alongside adding the option rather than left
  for later).
- **Focus indicator: `focus:` and `focus-visible:` are merged** for the
  removal-vs-replacement comparison, since the standard accessible pattern
  (`focus:outline-none focus-visible:ring-2`) spans both variants.
  - `isReplacement()`'s denylist was built via a systematic, one-time audit
    of Tailwind's real utility surface (not memory) — every candidate below
    was verified against a real Tailwind v4 build with computed styles
    checked in a real browser, not reasoned about abstractly:
    `border-none`/`border-hidden` (sets border-style but preflight resets
    border-width to 0 on every element, so no border is ever drawn, same
    failure mode as `border-0`); `border-spacing-*`/`-x-*`/`-y-*` (a
    table-cell-gap property with zero effect on any non-table element);
    `shadow-{color}`/`ring-{color}` alone, e.g. `shadow-red-500` (only sets
    the `--tw-shadow-color`/`--tw-ring-color` CSS variable — the actual
    `box-shadow` comes from a separate *size* utility like `shadow-lg`/
    `ring-2` that references it, so the color alone renders nothing).
    Confirmed *not* decoys, deliberately left alone: `outline-dashed`/
    `-dotted`/`-solid`/`-double` alone (unlike border-width, preflight does
    not reset `outline-width`, so the browser's default ~3px applies and
    the outline is genuinely visible) and any border-*width* utility alone,
    e.g. `border-t-4` (border-color defaults to `currentColor`, not
    transparent, so a width-only utility is genuinely visible).
  - Out of scope for this and future audits of this check: arbitrary
    variants (`[&:hover]`-style), first-party plugin utilities
    (`@tailwindcss/forms`, `@tailwindcss/typography` — not installed or
    processed by this engine), container queries, and `divide-*` utilities
    (they style child elements via a `> * + *` selector, not the element
    carrying the `focus:` class itself, so they're structurally inapplicable
    here regardless of visibility).
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

This pattern was found reactively, one instance at a time, until a
systematic one-time audit walked the focus-indicator check's entire risk
surface against a real Tailwind v4 build (see the "Focus indicator" bullet
above) and found five more in one pass: `border-none`/`border-hidden`,
`border-spacing-*`, and color-only `shadow-*`/`ring-*`. That audit also
confirmed the *other* two checks in this file have no equivalent risk: the
touch-target check resolves against a closed, enumerated lookup table
(`spacingScale`) rather than a permissive regex, so there's no same-shape-
different-meaning token possible there; the contrast check's `bg-*`
namespace was re-walked against every real `bg-*` utility category and
turned up nothing beyond what was already fixed (`opacity`/`linear`/
`conic`). If a new regex/token-matching check is ever added, prefer this
same approach — verify against the real tool's actual output, not memory —
over waiting for bugs to surface one at a time.

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
