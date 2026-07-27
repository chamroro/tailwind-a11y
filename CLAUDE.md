# tailwind-contrast-guard

## What this is

A static analysis CLI that catches WCAG contrast violations in Tailwind CSS
class combinations before they ship. Existing tools (e.g.
`tailwindcss-contrast-checker`) only catch violations where `text-*` and
`bg-*` land on the *same* element. This tool's differentiator is catching the
much more common **direct-parent** pattern:

```jsx
<div className="bg-white">
  <p className="text-gray-400">low contrast, but not on the same element</p>
</div>
```

## Scope (v1) — read before adding features

- **React/JSX only.** No Vue, Svelte, or Blade template support. If asked to
  add another framework, that's a new parser adapter, not a change to this
  one — don't generalize the JSX parser to try to handle multiple syntaxes.
- **Same-element + direct-parent only.** Do not walk further up the ancestor
  chain, and do not attempt to resolve backgrounds set by a wrapping
  component defined in another file (e.g. `<Card><Text/></Card>` where `Card`
  sets `bg-white` internally). That's a whole-program, type-aware analysis
  problem — explicitly out of scope. Known limitation, not a bug to fix.
- **Static `className` string literals only.** Ternaries, `clsx`/`cva`
  composition, and computed class names are not resolved. Skip them silently
  rather than guessing.
- **CLI + CI first.** No editor/LSP integration in v1. A VS Code extension is
  a plausible v2, not part of this build.
- **Default Tailwind palette only.** Color resolution uses a hardcoded
  snapshot of Tailwind's default color scale (see `src/theme/defaultPalette.ts`).
  Custom theme extension (reading a user's `tailwind.config`) is deferred.

These boundaries exist because the cross-component and dynamic-class cases
require whole-program type-aware analysis — a fundamentally different (and
much heavier) tool. Keeping v1 to same-element + direct-parent covers most
real-world contrast bugs at a fraction of the engineering cost.

## Architecture

```
src/
  theme/defaultPalette.ts   — Tailwind default color name -> hex map
  contrast/luminance.ts     — WCAG relative luminance + contrast ratio math
  parser/extractClasses.ts  — Babel JSX traversal; extracts text-*/bg-* pairs
                              per element, tracking direct-parent bg-*
  rules/checkContrast.ts    — combines the above into violation reports
  cli.ts                    — fast-glob scan, run checker, print report,
                              exit 1 on violations (for CI)
```

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
