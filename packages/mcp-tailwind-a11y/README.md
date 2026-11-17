# mcp-tailwind-a11y

An [MCP](https://modelcontextprotocol.io) server that lets a coding agent check the Tailwind CSS classes it just wrote for WCAG accessibility violations, and get fix suggestions back. It wraps the same engine as the [`tailwind-a11y`](../tailwind-a11y) CLI, the ESLint plugin, the VS Code extension and the GitHub Action.

The loop it is built for: the agent writes UI code, calls a tool, reads what failed (and what could not be checked), fixes it, and calls again.

## Install

```sh
# Claude Code
claude mcp add tailwind-a11y -- npx -y mcp-tailwind-a11y
```

Most MCP clients accept a command-based server entry of this shape; check your client's documentation for where it goes:

```json
{
  "mcpServers": {
    "tailwind-a11y": {
      "command": "npx",
      "args": ["-y", "mcp-tailwind-a11y"]
    }
  }
}
```

It talks over stdio and needs Node 20 or newer. The first `npx` run downloads about 130 packages (roughly 33 MB): the official MCP SDK depends on HTTP server libraries such as `express` and `hono` for its HTTP transport, and they come with it even though this server only uses stdio.

### Project root

The server reads files, and looks for a Tailwind config, under one directory: the **project root**. By default that is the directory the server is started in. To set it explicitly:

```sh
npx -y mcp-tailwind-a11y --root /path/to/project     # or TAILWIND_A11Y_ROOT=/path/to/project
```

The root is fixed when the server starts. A client cannot change it, because a JavaScript Tailwind config (`tailwind.config.js`/`.cjs`/`.mjs`) is **executed** to read its theme; if the tool arguments could choose the directory, a prompt-injected agent could make the server run code from anywhere. For the same reason `configPath` must point to a `.js`/`.cjs`/`.mjs`/`.css` file inside the root, file paths that leave the root (by `..`, an absolute path, or a symlink) are refused, and a Tailwind config that is a symlink pointing outside the root is ignored, whether it was named or auto-detected.

What this does and does not protect against: a tool call cannot make the server read or run anything outside the root. But a Tailwind JS config **inside** the root runs with the server's privileges, so anyone who can write files in the root can run code as the server. Point `--root` at one project you trust, not at `/` or your home directory (the server prints a warning if you do).

## Tools

Both tools are read-only and idempotent.

### `check_tailwind_a11y`

Checks a JSX/TSX snippet.

| Argument | |
|---|---|
| `code` | The source to check. Required. |
| `filePath` | Label used in results. Default `snippet.tsx`. |
| `strict` | Also enforce the AAA tier: 44px touch targets, 2px focus indicators, reduced motion. Default `false`. |
| `configPath` | Tailwind config inside the root. Default: auto-detected. |

### `check_tailwind_a11y_files`

Checks `.jsx`/`.tsx` files under the root, read from disk so the agent does not have to send the code back. Takes `paths` (1–50, relative to the root), plus `strict` and `configPath` as above. A refused, missing or unsupported path is reported on that file and does not stop the others.

Results are bounded so they stay readable and the server stays responsive: at most 200 violations are listed per call (the summary carries the true count and `truncated` says whether the list was cut), a call reads at most 5 MB of source in total, and a single source is capped at 1 MB.

### What comes back

```jsonc
{
  "summary": { "parsed": true, "violations": 1, "skipped": 1, "truncated": false },
  "violations": [
    {
      "line": 3,
      "wcag": "1.4.3",
      "type": "contrast",
      "message": "text-gray-400 on bg-white — ratio 2.54, needs 4.5 (AA); try text-gray-500 (4.83)",
      "details": { "textClass": "text-gray-400", "bgClass": "bg-white", "ratio": 2.5388, "suggestion": "text-gray-500" }
    }
  ],
  "skipped": [
    { "line": 4, "reason": "<span> className is not a plain string literal (cn(...) call) — not statically resolved, so none of its classes were checked" }
  ],
  "warnings": []
}
```

**An empty `violations` list is not a pass.** Read `skipped` and `warnings` too:

- `skipped` lists elements that could not be checked, most often a `className` built with `cn()`, `clsx()` or a template literal. Only plain string-literal classNames are read.
- If the code cannot be parsed as JSX/TSX, nothing is checked, `summary.parsed` is `false`, and the call is returned as an error rather than as a clean result.
- `check_tailwind_a11y_files` is an error only when no file could be checked. Otherwise `summary.unchecked` counts the files that could not be (unreadable, refused, or unparsable); each of those says why in its `error`, and none of them is a pass.

## What it checks

Contrast (WCAG 1.4.3), focus indicator removal (2.4.7) and contrast (1.4.11), touch target size (2.5.8), and with `strict` also 2.5.5, 2.4.13 and reduced motion (2.3.3). The scope, and what is deliberately left out, is described in the [engine README](../tailwind-a11y/README.md) and its [CLAUDE.md](../tailwind-a11y/CLAUDE.md).

## Known limits

- Custom colors and spacing are read from a `tailwind.config.js`/`.cjs`/`.mjs` in the root, or from a Tailwind v4 `@theme` block in one of a fixed list of CSS files (`app/globals.css`, `src/app/globals.css`, `styles/globals.css`, `src/styles/globals.css`, `src/index.css`, `globals.css`). A theme anywhere else is not found automatically; pass its path as `configPath`.
- `.js`, `.cjs` and CSS configs are re-read on every call, so an edit is picked up straight away. A `.mjs` config is not: Node caches an ES module it loaded through `require`, so an edit to one needs a server restart.
- The server can only see what is on disk under its root or in the code it is sent. It does not resolve a background set by a component defined in another file.
