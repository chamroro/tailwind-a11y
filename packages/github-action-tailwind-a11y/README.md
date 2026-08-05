# github-action-tailwind-a11y

GitHub Action for [`tailwind-a11y`](https://github.com/chamroro/tailwind-a11y/tree/main/packages/tailwind-a11y) —
WCAG violations reported as **inline PR annotations on the exact violating lines**,
powered by the same engine as the CLI, ESLint plugin, and VS Code extension. No
detection logic is duplicated, so results never disagree.

## Usage

```yaml
name: a11y
on: pull_request

jobs:
  tailwind-a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7   # required first -- the action scans your checkout
      - uses: chamroro/tailwind-a11y@v0
```

Violations show up as error annotations in the PR's Files changed view, in the
job log, and as a table in the job summary. The job fails when violations are
found (configurable below).

## Inputs

| Input | Default | Description |
|---|---|---|
| `patterns` | `**/*.{jsx,tsx}` | Whitespace/newline-separated glob pattern(s) to scan |
| `config` | auto-detect | Path to a `tailwind.config.js`/`.cjs` for custom theme colors/spacing |
| `fail-on-violations` | `"true"` | Set `"false"` to annotate without failing the job |

```yaml
- uses: chamroro/tailwind-a11y@v0
  with:
    patterns: |
      src/**/*.tsx
      app/**/*.jsx
    config: ./tailwind.config.cjs
    fail-on-violations: "false"
```

## Notes

- `node_modules`, `dist`, `build`, and `.git` directories are always excluded
  from scanning.
- GitHub renders roughly 10 inline annotations per step — beyond that, the
  full list is still in the job log and the job summary table, and the exit
  code always reflects every violation found.
- Pin a commit SHA instead of `@v0` if you want fully immutable behavior:
  `uses: chamroro/tailwind-a11y@<sha>`.
- Checks and known limitations are the engine's:
  [scope](https://github.com/chamroro/tailwind-a11y/tree/main/packages/tailwind-a11y#scope).

## License

MIT
