# tailwind-contrast-guard

A static-analysis CLI that catches [WCAG](https://www.w3.org/WAI/WCAG21/quickref/) contrast
violations in Tailwind CSS class combinations before they ship.

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

`tailwind-contrast-guard` resolves that direct-parent case too — its whole reason to exist.

## Install

```bash
npm install --save-dev tailwind-contrast-guard
```

## Usage

```bash
npx tw-contrast-guard                    # scans **/*.{jsx,tsx} from the current directory
npx tw-contrast-guard "src/**/*.tsx"     # or pass your own glob pattern(s)
```

Example output:

```
src/components/Card.tsx
  3: text-gray-400 on bg-white — ratio 2.54, needs 4.5 (AA)

1 violation(s) in 1 file(s)
```

Exits with code `1` when violations are found, `0` otherwise — drop it into CI:

```yaml
# .github/workflows/a11y.yml
- run: npx tw-contrast-guard
```

## What it catches

- `text-*` / `bg-*` color utilities on the **same element**
- `text-*` on a child with `bg-*` on its **immediate JSX parent** (one level up, exactly)
- Tailwind's default color palette, plus arbitrary hex values (`text-[#123456]`)
- Static `className="..."` string literals

## What it deliberately doesn't catch (v1 scope)

These are intentional limitations, not bugs — each would require a fundamentally heavier
tool (whole-program, type-aware analysis) for a comparatively rare payoff:

- **Ancestors beyond the immediate parent**, or backgrounds set inside a separately-defined
  wrapping component (e.g. `<Card><Text/></Card>` where `Card` sets `bg-white` internally)
- **Dynamic or computed `className`** — ternaries, template literals, `clsx()`/`cva()`
  composition. These are silently skipped, never guessed at.
- **Custom theme colors** not in Tailwind's default palette (e.g. `text-brand-500`)
- **Color + opacity shorthand** (`bg-white/50`) — skipped rather than alpha-composited,
  since a wrong guess is worse than no answer
- **Large-text thresholds** (3.0:1 instead of 4.5:1) — every check currently uses the
  normal-text AA threshold
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
