# mcp-tailwind-a11y

A thin MCP (stdio) adapter over the `tailwind-a11y` engine, so a coding agent can check the
Tailwind classes it just wrote and get fix suggestions back. Like every adapter it contains no
detection logic: it calls `analyzeSource`/`formatViolation`/`wcagCriterion` from the engine and
only adds the transport, the tool schemas, and the safety rules below. Repo-wide conventions
(versioning, publishing, lockfile handling) are in the root `CLAUDE.md`.

## Layout

```
src/handlers.ts      pure handlers (checkCode, checkFiles) + path/config guards; no SDK import
src/createServer.ts  McpServer + registerTool wiring, zod schemas, annotations
src/server.ts        the bin: --root parsing, stdout protection, stdio transport
```

`createServer` is separate from the bin so tests can import it without starting a stdio server.
The package has no `main`, deliberately: importing `server.js` would start the server.

## Invariants (each is pinned by a test that was checked against a deliberately weakened copy)

- **The project root is fixed by whoever starts the server and is never a tool argument.** The
  engine runs a JS Tailwind config with `require()` to read its theme, so a model-controlled
  directory would be model-controlled code execution. `configPath` must be a `.js`/`.cjs`/`.mjs`/
  `.css` file inside the root, judged case-sensitively (the engine decides CSS-vs-JS by an exact
  `.css` suffix) and again on what a symlink resolves to.
- **Every config goes through the same guard**, the explicit `configPath` and the auto-detected
  one alike. A symlink inside the root that points outside is ignored with a warning either way.
- **Paths are checked lexically first, then after `realpath`.** The first check answers an
  outside-the-root path identically whether or not the file exists, so the error cannot be used to
  probe the filesystem; the second catches symlinks. Containment is compared as relative path
  segments, not a string prefix (a sibling `<root>-other` must fail, a directory named `..foo`
  must pass). `realpath.native` is used so case-insensitive filesystems report real case.
- **"No violations" is never presented as "passed".** Unparsable code is an error with
  `parsed:false`; elements that could not be checked come back in `skipped`; a file that could not
  be read or parsed is counted in `summary.unchecked`.
- **stdout carries the protocol and nothing else.** A Tailwind config can `console.log` or write
  to `process.stdout`, which would corrupt the stream, so `server.ts` hands the transport its own
  writer and redirects everything else that writes to stdout onto stderr. The transport's writer
  delegates to the *original* `process.stdout.write` (not `fs.writeSync`, which can throw `EAGAIN`
  on a full pipe).
- **Responses are bounded.** Lists stop at `MAX_REPORTED` (with `truncated` and the true counts in
  `summary`), one shared violation budget spans the files of a call, a call reads at most
  `MAX_CALL_BYTES`, and `maxToolInputElements` caps input arrays before zod validates them.
- **Errors carry no absolute path** (Node error codes are reported, not messages).

## Known, accepted limits

- Anyone who can write files under the root can make the server run code with its privileges
  (by writing a `tailwind.config.cjs`); the guards stop a *tool argument* from doing it, not a
  writer of the root. Point `--root` at one project, not `/` or `$HOME` (the server warns).
- There is a theoretical race between the path check and the read (a file swapped for a symlink in
  between); it needs write access under the root, which already implies the above.
- Processing is synchronous, so a call blocks the server while it runs; the byte and violation
  limits keep that to seconds.
- The official SDK declares HTTP-server libraries (`express`, `hono`, ...) as hard dependencies,
  so an install is around 130 packages / 33 MB even though only stdio is used. It cannot be
  trimmed from this package's `package.json`.
- `zod` must stay `>=4.6.6` (GHSA-mrhx-c7xc-m3w5, memory exhaustion while validating large
  arrays); the SDK accepts `^3.25 || ^4`, but 3.x has no patched release.

## Testing notes

- The stdio tests run the built bin, so `npm run build` must come first (the same order the
  ESLint plugin's tests already rely on for the engine's dist). They speak raw JSON-RPC to a
  child process and check that every stdout line parses: an SDK client silently drops non-JSON
  lines, so it cannot detect pollution.
- Changing a guard? Weaken it on a scratch copy and confirm a test fails; a first version of the
  stdio test passed with a `console.log` planted in a handler.
