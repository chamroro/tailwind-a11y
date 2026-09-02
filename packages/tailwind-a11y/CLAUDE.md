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
focus indicator removal/contrast, and reduced motion for interaction-
triggered animation. Existing contrast tools (e.g.
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
  - JS path: `tailwind.config.js`/`.cjs`/`.mjs`, reads only
    `theme.extend.colors`/`theme.extend.spacing` — never a full
    `theme.colors`/`theme.spacing` replacement. A `.js` config inside a
    `"type": "module"` project throws `ERR_REQUIRE_ESM` on `require()` —
    caught, treated the same as "no config found," not a crash.
  - `.mjs` support (added after initially being ruled out) works via plain
    `require()` — verified that Node 20.19+/22.13+ can `require()` an ESM
    module **synchronously**, no `import()`, no async refactor needed.
    `require()` returns the module namespace object
    (`{ __esModule: true, default: <export>, ... }`), unwrapped with a
    one-line check in `loadCustomTheme.ts` before reading `theme.extend`
    that a plain `module.exports = {...}` CJS config never accidentally
    matches. On an older Node this throws `ERR_REQUIRE_ESM`, already caught
    above — the same graceful "no config found" fallback, not a crash.
    Every adapter's actual runtime already clears the threshold: the
    GitHub Action runs on Node 24 (`action.yml`), the ESLint plugin's own
    `engines.node` already excludes every version that lacks this, and the
    CLI's broad `>=18` floor just degrades safely on anything older.
    **Known limitation, not fixed**: `bustRequireCache()`'s cache-busting,
    which is what lets a long-lived process (the VS Code extension host)
    pick up a `.js`/`.cjs`/`.css` config edit without restarting, does
    **not** work for `.mjs` — Node caches a synchronously-required ESM
    module in its own internal registry, not (only) `require.cache`,
    confirmed with a real edit-and-reload test. CLI/GitHub Action are
    unaffected (fresh process per run); editing a `.mjs` config in VS Code
    requires reloading the window.
  - `.ts` config files are a deliberate non-goal, not a "not yet." Node's
    native TypeScript type-stripping only activates when the *host* process
    itself is launched with `--experimental-strip-types` — verified this
    session that a library has no way to turn this on for the user, so the
    only way to support `.ts` transparently would be promoting `esbuild`
    from a devDependency to a genuine runtime dependency of this package, a
    real native-binary weight increase. Also verified: a fresh
    `create-next-app --typescript --tailwind` no longer generates any
    JS/TS config file at all — current Tailwind v4 projects put theme
    customization in a CSS `@theme` block instead (already fully supported,
    see the CSS path below), so `.ts` config support would only help a
    shrinking population of legacy v3-plus-TypeScript projects — declined
    as not worth the dependency.
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
  - Per color entry (both paths): a plain hex-string value or a CSS
    `oklch(L C H)` value is accepted — `themeValueParsers.ts`'s
    `parseColorScale()` tries `hexToRgb` first, then `oklchToRgb`
    (`contrast/oklch.ts`), converting an accepted `oklch()` to hex once at
    ingestion via `rgbToHex` so nothing downstream (`checkContrast.ts`,
    `checkFocusIndicator.ts`, every adapter) ever needs to know a color
    started life as OKLCH. Added specifically because Tailwind v4's own
    default palette and most of its ecosystem (shadcn/ui, v4 starters)
    define brand colors as `oklch()`, not hex — before this, those colors
    were silently unresolvable, not "checked and passed." The OKLab
    conversion matrices were verified against a real headless Chrome
    (`playwright-core`, canvas + `getImageData` pixel readback — not
    `getComputedStyle().color`, which modern Chrome now serializes back out
    as `oklch()` rather than converting to `rgb()`) across in-gamut,
    out-of-gamut (confirms clamping matches the browser, not just rejection
    of the in-gamut cases), and percentage-`L`/percentage-`C`/`deg`-suffix
    syntax variants — 0 channel difference in every case, same "verify
    against the real tool's actual output, not memory" discipline as the
    focus-indicator audit below. An alpha component (`oklch(L C H / A)`) or
    the `none` keyword is unsupported and falls through to skip — the
    palette only ever stores opaque colors (`HEX_RE` doesn't accept
    4/8-digit hex with alpha either), so this mirrors an existing limit
    rather than a new one. `rgb()`/`hsl()`/`var()`/etc. remain skipped, same
    "not a resolvable value -- skip, don't guess" precedent as before. A
    flat string color (`colors: { brand: '#3490dc' }`) or a `DEFAULT` key is
    skipped on the JS path — no class syntax (`bg-brand-DEFAULT` isn't real
    Tailwind) would ever resolve to it.
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
  `settings["tailwind-a11y"]` instead, since it's shared by whichever rules
  need theme resolution (contrast, touch-target, and now focus-contrast — see
  below) and `strict` isn't), VS Code `tailwind-a11y.strict` setting,
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
    `ring-2` that references it, so the color alone renders nothing);
    `ring-offset-{color}` alone, e.g. `ring-offset-blue-500` (one level
    deeper than plain `ring-{color}` — sets only `--tw-ring-offset-color`,
    same "no box-shadow without a real ring width" mechanism — missed by
    the original one-time audit and only found later via independent
    adversarial testing, since `isColorOnlyShadowOrRing`'s `ring-(.+)`
    match doesn't recurse into the `offset-` sub-shape; needed its own
    `isColorOnlyRingOffset` check).
    Confirmed *not* decoys, deliberately left alone: `outline-dashed`/
    `-dotted`/`-solid`/`-double` alone (unlike border-width, preflight does
    not reset `outline-width`, so the browser's default ~3px applies and
    the outline is genuinely visible) and any border-*width* utility alone,
    e.g. `border-t-4` (border-color defaults to `currentColor`, not
    transparent, so a width-only utility is genuinely visible).
  - `inset-shadow-*`/`inset-ring-*` (Tailwind v4's inset box-shadow family)
    are their own prefix, not `shadow`/`ring` with a suffix — missed by the
    original audit (these utilities either didn't exist yet or weren't
    considered) and found later via independent adversarial testing, in the
    *opposite* direction from every other case here: a real
    `inset-shadow-sm`/`inset-ring-2` replacement was being **rejected**,
    since a string starting with `inset-` never matched the `shadow`/`ring`
    prefix alternatives at all — a false positive on the overall check
    (reported the outline as removed with nothing put back, when something
    real was there). Fixed by adding `inset-shadow`/`inset-ring` as their
    own alternatives. Once added, the same two decoy shapes as their
    outer-ring/shadow counterparts apply and were verified against a real
    build: `inset-shadow-none`/`inset-ring-0` are degenerate (zero-value,
    real but invisible, added to `DEGENERATE_BASES`), and
    `inset-shadow-{color}`/`inset-ring-{color}` alone are color-only
    (extended `isColorOnlyShadowOrRing`'s existing regexes with an optional
    `inset-` prefix rather than a third copy). `inset-ring-offset-*`
    doesn't exist as a real Tailwind utility (confirmed via the same real
    build — it compiles to nothing), so no equivalent of
    `isColorOnlyRingOffset` was needed for the inset family.
  - Out of scope for this and future audits of this check: arbitrary
    variants (`[&:hover]`-style), first-party plugin utilities
    (`@tailwindcss/forms`, `@tailwindcss/typography` — not installed or
    processed by this engine), container queries, and `divide-*` utilities
    (they style child elements via a `> * + *` selector, not the element
    carrying the `focus:` class itself, so they're structurally inapplicable
    here regardless of visibility).
- **Focus indicator contrast: `checkFocusContrast(checks, strict?)` is a
  second, independent check on the same `focus:`/`focus-visible:` classes** —
  `checkFocusIndicators` above only asks "was the outline removed with
  nothing put back"; it never looks at whether a present indicator is
  actually *visible*. `focus:outline focus:outline-2 focus:outline-blue-400`
  on `bg-blue-500` reported zero violations before this check existed, even
  though `blue-400`-on-`blue-500` is nowhere near visible. WCAG **1.4.11**
  Non-text Contrast (AA) requires 3:1 for UI-component state indicators —
  explicitly including focus indicators, per the W3C Understanding doc — and
  is always enforced. **2.4.13** Focus Appearance (AAA, opt-in `strict`) does
  **not** raise that 3:1 the way touch-target's AA→AAA does; it adds a
  second, independent minimum-thickness requirement (>= a 2 CSS pixel
  perimeter). A pure-contrast failure is always reported as `level: "AA"`
  even under `strict`; only a thickness failure is `"AAA"` — the violation's
  `level` reflects which SC actually failed, not just whether `strict` is on.
  - Deliberately narrow scope: only an explicit `outline-{color}`/`ring-
    {color}` under `focus:`/`focus-visible:` counts as "the indicator" —
    `border-*`/`bg-*`/`shadow-*` replacements (valid for the 2.4.7 removal
    check above) aren't resolved for contrast. Background resolution reuses
    `extractClasses.ts`'s same-element-or-immediate-parent walk; unresolvable
    → skipped, not guessed.
  - Verified against a real `tailwindcss@4.3.3` compile: bare `ring`/
    `outline` (no width digit) both resolve to `1px` in Tailwind v4, but
    v3's bare `ring` default is documented elsewhere as `3px` — a real
    cross-version difference this tool can't currently distinguish. So only
    an explicit `outline-{0,1,2,4,8}`/`ring-{0,1,2,4,8}` or an arbitrary
    `[Npx]` resolves a thickness value; bare `ring`/`outline` contributes
    color (if paired with an explicit color utility) but the thickness
    dimension is silently left unassessed for it under `strict`, never
    asserted a false pass or fail.
  - The 3:1 threshold is a flat local constant (`NON_TEXT_MIN_RATIO`), not
    `luminance.ts`'s `requiredRatio()`/`meetsWCAG()` — those model the
    text-specific large-text/small-text AA/AAA table, which doesn't apply to
    UI-component contrast. `resolveColorValue()` (`checkContrast.ts`) is
    generalized from its `text`/`bg` prefix union to also accept `outline`/
    `ring` — same palette/arbitrary-hex/semantic-color resolution, reused
    rather than duplicated.
  - Exposed the same opt-in way as touch-target's `strict`, reusing the
    exact same flag: CLI `--strict`, VS Code `tailwind-a11y.strict` setting,
    GitHub Action `strict` input all now affect both checks from one toggle.
    ESLint is the one exception — `tailwind-a11y/focus-contrast` has its own,
    independently-configurable `strict` rule option (own file, own schema),
    since ESLint has no plugin-wide toggle and each rule's options are
    already independently set.
- **Reduced motion: `checkReducedMotion(checks, strict?)` is WCAG 2.3.3
  (AAA), the first check in this project with no AA tier to fall back to at
  all.** Verified against the W3C Understanding doc that "motion animation"
  specifically means a change to an element's perceived size, shape, or
  position — color/opacity/blur changes don't qualify, even though they're
  visually "animated" in the everyday sense. This is why an **unscoped**
  `animate-spin`/`-ping`/`-pulse`/`-bounce` is still not covered: continuous,
  not interaction-triggered, so it belongs under 2.2.2 (Pause, Stop, Hide)
  instead, which has a materially different, harder-to-statically-verify
  requirement (a 5-second-or-longer duration threshold this tool has no way
  to know) — folding it in here would misattribute the wrong SC.
  **Interaction-scoped `animate-*` (`hover:animate-bounce`) is a second,
  independent detection path under this same check, closing what was
  previously a documented gap.** `animate-*` utilities carry their own
  `animation` property and need no `transition-*` base at all, so
  `checkReducedMotion` runs a fully separate block per check — computed
  *before* the transition path's `continue` statements, not appended after
  them, since an element with only `hover:animate-bounce` never sets
  `realTransition` and would otherwise be skipped past entirely — that can
  independently push its own violation, meaning one element can produce up
  to two violations (one per mechanism) if both are genuinely present.
  `ANIMATE_MOTION_BASES = new Set(["animate-spin", "animate-ping",
  "animate-bounce"])`, verified against real Tailwind v4 compiled keyframes:
  spin → `rotate(360deg)` (shape/orientation), ping → `scale(2)` +
  `opacity:0` (includes a size change, so it qualifies same as any other
  scale change regardless of the accompanying opacity fade), bounce →
  `translateY(-25%)` (position) — `animate-pulse` (opacity-only) and
  `animate-none` (the off/identity value) are excluded, same treatment as
  `scale-100`/`rotate-0` on the transition side. The guard is a separate
  `hasMotionReduceAnimateGuard` (bare, single-segment
  `motion-reduce:animate-none` only) — kept independent from the transition
  side's `hasMotionReduceGuard` so one mechanism's guard can't wrongly
  suppress the other's violation. The extractor's candidacy gate
  (`extractReducedMotion.ts`) adds this as a **single-class** OR condition —
  one class must be both an `animate-` base and interaction-scoped in its own
  variant stack — not two independent whole-element flags the way
  `hasTransitionBase`/`hasInteractionClass` work for the transition path.
  That distinction matters: `transition-transform` is never itself
  interaction-scoped (paired with a separate `hover:scale-110`), but an
  `animate-*` class is simultaneously its own trigger and its own animator,
  so two independent flags would wrongly treat `animate-spin
  hover:text-red-500` (an unscoped, continuously-running animation next to
  an unrelated hover class) as a candidate — exactly the 2.2.2-not-2.3.3 case
  above.
  - Because there's no AA tier, this is gated behind `strict` in every
    scan-everything-by-default adapter (CLI, VS Code, GitHub Action) — an
    AAA-only check running unconditionally would silently start failing
    existing users' CI on a routine upgrade, unlike the genuinely-AA
    `checkFocusIndicators` (2.4.7), the one other check in this file with no
    strict tier. The ESLint rule is the one exception: enabling
    `tailwind-a11y/reduced-motion` in a config is itself the opt-in
    gesture, so it always checks for real (`schema: []`, no option, same as
    `focus-indicator.ts`) — and it's deliberately **not** included in
    `configs.recommended` either, for the same "AAA shouldn't silently ride
    along with an AA baseline" reason.
  - Not scoped to `isInteractiveElement()` — the Understanding doc's own
    examples aren't limited to buttons/links (a plain hover-animated `<div>`
    card is exactly the target case), so it walks every JSX element with a
    static `className`, same as `extractClasses.ts`'s contrast check.
    Interaction variants recognized: `hover`/`focus`/`focus-visible`/
    `focus-within`/`active`.
  - Variant detection scans **every** segment of a stacked variant class
    (`variantSegments()`), not just the one immediately before the base
    utility — caught in independent review: `motion-safe:hover:scale-110`
    and `hover:motion-safe:scale-110` compile to the identical nested media
    query (verified against a real v4 build), so checking only the
    innermost segment made the original implementation order-dependent —
    it recognized the interaction variant, or a `motion-safe:` self-guard on
    the motion utility itself, only when written last, silently missing the
    equally valid reverse ordering. Fixed by checking membership across the
    whole variant stack instead of a single position, in both the extractor
    and the rule.
  - Only `transition`/`transition-all`/`transition-transform` count as a
    qualifying transition base — verified against a real Tailwind v4 build
    that these three are the only ones whose `transition-property` list
    includes `transform`/`translate`/`scale`/`rotate`; `transition-colors`/
    `-opacity`/`-shadow` don't, so a `scale-*` change under `hover:` on an
    element with only one of those never actually animates (nothing tells
    the browser to transition that property), and correctly isn't flagged.
    A transition only needs checking when it actually persists into the
    resting state and has no relationship to `prefers-reduced-motion` —
    **not** the same thing as literally unscoped, corrected after
    independent adversarial testing found a real false negative in an
    earlier version that required zero variants at all
    (`segments.length === 0`), silently treating `dark:transition
    hover:scale-110` as compliant even though it genuinely animates on
    hover whenever dark mode is active, with zero connection to the user's
    motion preference. The actual rule has two exclusions, for two
    different reasons:
    - An interaction pseudo-class (`hover:`/`focus:`/`focus-within:`/
      `active:`) anywhere in the transition's own variant stack excludes
      it — a transition scoped to `hover:` isn't present a moment *before*
      hover begins, so CSS has nothing to transition *from* right as the
      interaction starts (an instant snap, not an animation). This is the
      one case the old "must be literally unscoped" check happened to get
      right, for the wrong stated reason.
    - `motion-safe:` anywhere in the stack excludes it for an unrelated
      reason: a complete, persistent exemption — the transition simply
      doesn't exist unless motion is already safe, one of the three
      approaches the Understanding doc names, not a partial fix.
    Anything else (`dark:`, `sm:`, `lg:`, ...) is a persistent precondition
    with no bearing on either of those two exclusions, so it's treated as
    real and checked.
  - A `motion-reduce:transition-none`/`transform-none` guard is only
    trusted when it's **bare** — no other variant stacked with it.
    Independent adversarial testing found a real false negative here too:
    `sm:motion-reduce:transition-none` was accepted as a full guard, but it
    only suppresses the transition at or above the `sm` breakpoint, leaving
    it completely unguarded below that width. Correctly modeling whether an
    arbitrary guard's extra conditions are a subset of the real trigger's
    conditions is out of scope — requiring the guard to be fully
    unconditional is the same "skip/flag rather than guess" posture used
    everywhere else in this project, erring toward the less-bad failure
    mode (false positive) over the worse one (false negative).
  - Each transform utility's identity value is excluded (`scale-100`,
    `rotate-0`, `translate-x-0`/`-y-0`, `skew-x-0`/`-y-0`, either sign) —
    real utilities that move nothing, the same "shape looks real but isn't"
    failure class noted below. Arbitrary bracket values (`scale-[1.5]`) and
    3D transform utilities (`rotate-x-*`, `translate-z-*`, confirmed to
    exist in a real v4 build) are out of scope for v1 — unmatched, so
    silently not considered "motion" rather than guessed at.
- **Contrast: opacity modifiers (`text-gray-400/50`) are resolved on the
  *text* side only**, composited against the already-resolved (fully opaque)
  background — see `resolveTextColorWithOpacity()`/`applyAlpha()` in
  `rules/checkContrast.ts`/`contrast/luminance.ts`. Deliberate cuts:
  - The *background* side (`bg-white/50` as the actual background) stays
    unresolvable. Compositing it correctly requires knowing what's rendered
    behind it (grandparent-or-beyond) — the same ancestor-walk this file
    already scopes out for plain (non-opacity) backgrounds. `--verbose`'s
    skip reason for this (`checkContrastValueSkips`'s `bgSkipReason()`)
    distinguishes it from a genuinely unresolvable color: `bg-gray-800/50`
    reports "a recognized color, but background-side opacity isn't
    resolved," not "not a recognized color" — caught in independent
    adversarial testing, since `gray-800` is a real default-palette color
    and the old generic message would send a developer looking for a theme
    entry to add, which was never the actual problem.
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
  parser/extractReducedMotion.ts  — transition + hover:/focus:/active: classes on any element
  rules/checkContrast.ts          — contrast violations (WCAG 1.4.3, AA);
                                     resolves a text-side opacity modifier
                                     against the resolved (opaque) bg; also
                                     suggestContrastFix() — nearest passing
                                     shade in the same color scale (text side
                                     only, bg and any opacity held fixed)
  rules/checkTouchTarget.ts       — touch target violations (WCAG 2.5.8 AA /
                                     2.5.5 AAA under strict)
  rules/checkFocusIndicator.ts    — focus indicator removal (WCAG 2.4.7, AA)
                                     and focus indicator contrast (WCAG
                                     1.4.11 AA / 2.4.13 AAA under strict)
  rules/checkReducedMotion.ts     — reduced motion violations (WCAG 2.3.3,
                                     AAA-only, gated behind strict)
  cli.ts                         — fast-glob scan, run all five checkers,
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
claimed the contrast check's `bg-*` namespace had been re-walked and turned
up nothing beyond `opacity`/`linear`/`conic` — **this later turned out to be
incomplete**: the audit only checked for same-shape *base utility names*
that could mask a color, not the orthogonal case of a *variant-scoped*
color masking the real resting-state one. `lastColorToken()` (and the
near-duplicate `lastIndicatorColorToken` this used to be, now
`lastColorTokenForIndicator`) stripped `hover:`/`dark:`/`md:`/etc. prefixes
*before* last-token-wins, so `bg-white dark:bg-gray-900` on an element with
`text-gray-300` silently reported nothing at all — `dark:bg-gray-900` won
last-token-wins purely by being written later, `gray-300`-on-`gray-900`
happens to pass, and the real 1.47:1 `gray-300`-on-`bg-white` resting-state
failure was never even attempted. Independent adversarial testing found
this (not the original audit). Fixed the same way `extractTouchTargets.ts`'s
`lastSizeToken` already handled it (`if (raw.includes(":")) continue;` —
skip a variant-scoped token entirely, don't let it participate in
resting-state resolution at all) — a guard `lastColorToken` never had.

A second, related bug found the same way: `checkFocusContrast` used to race
`outline-*` against `ring-*` in one shared last-token-wins slot, even though
both are independent CSS mechanisms (outline-color/-width vs. box-shadow)
that render *simultaneously* regardless of which is written first (verified
against a real v4 build) — so an element with a passing `outline-*` and a
failing `ring-*` got a verdict that flipped purely based on class order.
Fixed by evaluating each present indicator independently and only flagging
when *all* present indicators fail (a user only needs one sufficiently
visible indicator to perceive the focus state) — see
`lastColorTokenForIndicator`/`thicknessTokenForIndicator` in
`checkFocusIndicator.ts`.

Lesson for future audits: "does a same-shape token mask a real one" isn't
just about base-utility-name decoys — variant scope and cross-mechanism
racing are two more axes of the same last-token-wins risk, and a one-time
audit checking only the first axis will still miss the other two. If a new
regex/token-matching check is ever added, prefer verifying against the real
tool's actual output, not memory, over waiting for bugs to surface one at a
time — but also explicitly check all three axes (decoy names, variant
scope, cross-mechanism racing), not just whichever one motivated the
original audit.

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
