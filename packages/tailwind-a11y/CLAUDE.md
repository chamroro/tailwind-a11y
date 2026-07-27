# tailwind-a11y

(Renamed from `tailwind-contrast-guard` once a second and third check were
added — the GitHub repo itself keeps its original name, only npm package
metadata changed. Not yet published to npm, so this was a free pre-launch
rename with no back-compat concerns.)

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
- **CLI + CI first.** No editor/LSP integration in v1. A VS Code extension is
  a plausible v2, not part of this build.
- **Default Tailwind palette only.** Color resolution uses a hardcoded
  snapshot of Tailwind's default color scale (see `src/theme/defaultPalette.ts`).
  Custom theme extension (reading a user's `tailwind.config`) is deferred.
- **Default Tailwind spacing scale only.** Same reasoning as the color
  palette — see `src/theme/spacingScale.ts`.
- **Touch target: no `min-w-*`/`min-h-*` fallback.** A minimum-width utility
  only guarantees a floor, not the actual rendered size — using it would
  mean guessing, so elements without explicit `w-*`+`h-*` are skipped
  entirely rather than approximated. No inline-text-link exception either
  (WCAG 2.5.8 exempts links within a text block) — v1 simplicity.
- **Focus indicator: `focus:` and `focus-visible:` are merged** for the
  removal-vs-replacement comparison, since the standard accessible pattern
  (`focus:outline-none focus-visible:ring-2`) spans both variants.

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
  contrast/luminance.ts           — WCAG relative luminance + contrast ratio math
  parser/babelInterop.ts          — shared @babel/traverse CJS/ESM interop shim,
                                     parseJSX(), getStaticClassName()
  parser/isInteractiveElement.ts  — shared "is this element interactive" predicate
  parser/extractClasses.ts        — text-*/bg-* pairs per element (contrast)
  parser/extractTouchTargets.ts   — w-*/h-* pairs on interactive elements
  parser/extractFocusIndicators.ts— focus:/focus-visible: classes on interactive elements
  rules/checkContrast.ts          — contrast violations (WCAG 1.4.3, AA)
  rules/checkTouchTarget.ts       — touch target violations (WCAG 2.5.8, AA)
  rules/checkFocusIndicator.ts    — focus indicator violations (WCAG 2.4.7, AA)
  cli.ts                         — fast-glob scan, run all three checkers,
                                    print report, exit 1 on any violations (CI)
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
