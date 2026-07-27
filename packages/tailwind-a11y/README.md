# tailwind-a11y

A static analysis engine that resolves Tailwind CSS utility classes back into their real
computed values (colors, sizes, focus behavior) via AST parsing — so accessibility bugs
can be caught **before rendering**, in CI, instead of at a Lighthouse audit or QA pass
after the fact. Three [WCAG](https://www.w3.org/WAI/WCAG21/quickref/) checks ship on top
of that engine today: color contrast, touch target size, and focus indicator removal.

> Renamed from `tailwind-contrast-guard` once these three checks landed. This package now
> lives in the [`tailwind-a11y` monorepo](https://github.com/chamroro/tailwind-a11y)
> alongside its [ESLint plugin](https://github.com/chamroro/tailwind-a11y/tree/main/packages/eslint-plugin-tailwind-a11y).

## The actual problem this solves

The pain isn't "checking contrast" — plenty of tools do that. The pain is finding out
about an accessibility bug **late**: at a design review, an axe/Lighthouse audit, or a
QA pass, days or weeks after the code that caused it was written and merged. By the time
that class combination surfaces as one of forty findings on a spreadsheet, nobody
remembers why `text-gray-400` ended up on that element.

`tailwind-a11y` moves that feedback to write-time by actually understanding what a
Tailwind class *renders as* — not just matching class names, but resolving `text-gray-400`
to `#9ca3af`, `w-4` to `16px`, and evaluating those against the real WCAG formulas. That's
what makes it different from a linter that only knows class *names* exist:

```jsx
<div className="bg-white">
  <p className="text-gray-400">the background is on the parent, not this element</p>
</div>
```

Most existing Tailwind contrast checkers only catch `text-*`/`bg-*` on the **same**
element and miss this — extremely common — direct-parent pattern entirely, because they
never resolve the parent's class at all.

## What's built on the engine today

```jsx
<button className="w-4 h-4" onClick={...}>×</button>          {/* 16×16px, fails WCAG 2.5.8 */}
<button className="focus:outline-none">Save</button>          {/* no visible focus indicator */}
```

- **Contrast** (WCAG 1.4.3) — same-element and direct-parent `text-*`/`bg-*` combinations
- **Touch target size** (WCAG 2.5.8) — interactive elements under 24×24px
- **Focus indicator removal** (WCAG 2.4.7) — `focus:outline-none` with no visible replacement

These three exist because they're the checks a Tailwind-aware engine can answer with high
confidence today. The engine itself — turning a utility class into a real value — isn't
specific to accessibility; it's the reusable part, and more checks can sit on top of it
without becoming a different tool.

## Install

```bash
npm install --save-dev tailwind-a11y
```

## Usage

```bash
npx tailwind-a11y                    # scans **/*.{jsx,tsx} from the current directory
npx tailwind-a11y "src/**/*.tsx"     # or pass your own glob pattern(s)
npx tailwind-a11y --verbose          # also reports what couldn't be checked, and why
```

`--verbose` surfaces the coverage gap explicitly instead of leaving it invisible — e.g. a
custom theme color that can't be resolved, or a background set inside a wrapping
component this tool can't see into. A skip is not a pass; it means "not checked."

Example output:

```
src/components/Card.tsx
  3: text-gray-400 on bg-white — ratio 2.54, needs 4.5 (AA)
src/components/IconButton.tsx
  5: <button> is 16×16px (w-4 h-4) — WCAG 2.5.8 requires >= 24×24px
  12: <button> removes the focus outline (focus:outline-none) with no visible replacement

3 issue(s) in 2 file(s)
```

Exits with code `1` when issues are found, `0` otherwise — drop it into CI:

```yaml
# .github/workflows/a11y.yml
- run: npx tailwind-a11y
```

## What it catches

- **Contrast** (WCAG 1.4.3): `text-*`/`bg-*` on the **same element**, or `text-*` on a
  child with `bg-*` on its **immediate JSX parent** (one level up, exactly). Tailwind's
  default color palette, plus arbitrary hex values (`text-[#123456]`).
- **Touch target size** (WCAG 2.5.8): interactive elements (`button`, `a`, `input`,
  `select`, `textarea`, or any element with an `onClick` handler) sized below 24×24px via
  explicit `w-*`/`h-*` utilities.
- **Focus indicator removal** (WCAG 2.4.7): `focus:outline-none`/`focus-visible:outline-none`
  with no other `focus:`/`focus-visible:` utility (`ring-*`, `border-*`, `shadow-*`, `bg-*`,
  non-`none` `outline-*`) providing a visible replacement.
- All checks: static `className="..."` string literals only.

## What it deliberately doesn't catch (v1 scope)

These are intentional limitations, not bugs — each would require a fundamentally heavier
tool (whole-program or runtime analysis) for a comparatively rare payoff. When a check can't
be resolved with confidence, it is **skipped, not guessed** — a wrong "pass" is worse than
no answer:

- **Ancestors beyond the immediate parent**, or backgrounds set inside a separately-defined
  wrapping component (e.g. `<Card><Text/></Card>` where `Card` sets `bg-white` internally).
  This is the most common source of missed violations in real component-library-heavy
  codebases (MUI, Chakra, shadcn/ui, Radix) — resolving it would require whole-program,
  type-aware analysis across file boundaries, a different tool than this.
- **Dynamic or computed `className`** — ternaries, template literals, `clsx()`/`cva()`
  composition. These are silently skipped, never guessed at.
- **Custom theme colors/spacing** not in Tailwind's default scales (e.g. `text-brand-500`)
- **Color + opacity shorthand** (`bg-white/50`) — skipped rather than alpha-composited,
  since a wrong guess is worse than no answer
- **Large-text contrast thresholds** (3.0:1 instead of 4.5:1) — every check currently uses
  the normal-text AA threshold
- **`min-w-*`/`min-h-*` sizing**, and WCAG 2.5.8's inline-text-link exception — touch target
  checks require explicit `w-*`+`h-*`, no fallback/exception heuristics in v1
- Frameworks other than React/JSX (Vue, Svelte, Blade, …)
- Editor/LSP integration — this is a CLI/CI tool, not a VS Code extension (yet)

See [CLAUDE.md](./CLAUDE.md) for the full rationale behind these boundaries.

## Development

```bash
npm install
npm run dev -- "src/**/*.tsx"   # run the CLI against a project without building
npm test                        # vitest
npm run build                   # tsc -> dist/
```

## License

MIT
