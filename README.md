# tailwind-a11y

A static-analysis CLI that catches [WCAG](https://www.w3.org/WAI/WCAG21/quickref/)
accessibility violations in Tailwind CSS class combinations before they ship: color
contrast, touch target size, and focus indicator removal.

> Renamed from `tailwind-contrast-guard` once these three checks landed — the GitHub
> repo keeps its original name, only the npm package was renamed.

## The problem

Existing Tailwind contrast checkers only catch violations where `text-*` and `bg-*` land on
the **same element**:

```jsx
<p className="text-gray-400 bg-white">caught by most tools</p>
```

The far more common real-world bug is when the background comes from a **parent** element:

```jsx
<div className="bg-white">
  <p className="text-gray-400">not caught by most tools — but this fails WCAG AA</p>
</div>
```

`tailwind-a11y` resolves that direct-parent case too. It also catches two other common,
statically-detectable Tailwind footguns that general-purpose a11y linters
(`eslint-plugin-jsx-a11y` etc.) don't, because they're specific to how Tailwind utility
classes describe size and focus state:

```jsx
<button className="w-4 h-4" onClick={...}>×</button>          {/* 16×16px, fails WCAG 2.5.8 */}
<button className="focus:outline-none">Save</button>          {/* no visible focus indicator */}
```

## Install

```bash
npm install --save-dev tailwind-a11y
```

## Usage

```bash
npx tailwind-a11y                    # scans **/*.{jsx,tsx} from the current directory
npx tailwind-a11y "src/**/*.tsx"     # or pass your own glob pattern(s)
```

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
tool (whole-program or runtime analysis) for a comparatively rare payoff:

- **Ancestors beyond the immediate parent**, or backgrounds set inside a separately-defined
  wrapping component (e.g. `<Card><Text/></Card>` where `Card` sets `bg-white` internally)
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
