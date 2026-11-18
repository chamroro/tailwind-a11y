#!/usr/bin/env node
import { createRequire } from "node:module";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./createServer.js";

// ../package.json resolves from both src/ (dev) and dist/ (published).
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const HELP = `mcp-tailwind-a11y ${version}

An MCP server (stdio) that checks Tailwind CSS classes in JSX/TSX for WCAG
accessibility violations. Add it to an MCP client, for example:

  claude mcp add tailwind-a11y -- npx -y mcp-tailwind-a11y

Options:
  --root <dir>   Project root: where files are read from and where a Tailwind
                 config is looked up. Also settable with TAILWIND_A11Y_ROOT.
                 Default: the current directory. Fixed when the server starts;
                 a client cannot change it, because a JS Tailwind config under
                 it is executed to read the theme.
  --version      Print the version
  --help         Print this help
`;

// stdout carries the protocol and nothing else; anything meant for a person
// goes to stderr.
function fail(message: string): never {
  console.error(`mcp-tailwind-a11y: ${message}`);
  process.exit(1);
}

function parseRoot(argv: string[]): string {
  let root = process.env.TAILWIND_A11Y_ROOT || process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") {
      const value = argv[++i];
      if (!value) fail("--root needs a directory");
      root = value;
    } else if (arg.startsWith("--root=")) {
      root = arg.slice("--root=".length);
      if (!root) fail("--root needs a directory");
    } else {
      fail(`unknown argument: ${arg} (see --help)`);
    }
  }
  let real: string;
  try {
    real = realpathSync.native(resolve(root));
  } catch {
    return fail(`project root does not exist: ${root}`);
  }
  if (!statSync(real).isDirectory()) fail(`project root is not a directory: ${root}`);
  return real;
}

// Hands the transport a stdout that only it can reach, and sends everything
// else that writes to stdout to stderr instead. A Tailwind JS config is run to
// read its theme, and one that logs (console.log, or process.stdout.write
// without a newline) would otherwise put non-protocol text on the stream the
// client is parsing and corrupt the next response.
function protectStdout(): Writable {
  const writeToClient = process.stdout.write.bind(process.stdout);
  const toStderr = (...args: unknown[]) => console.error(...args);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) =>
    (process.stderr.write as (...a: unknown[]) => boolean)(chunk, ...rest)) as typeof process.stdout.write;
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  return new Writable({
    write(chunk, _encoding, callback) {
      writeToClient(chunk, callback);
    },
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version")) {
    process.stdout.write(`${version}\n`);
    return;
  }

  const root = parseRoot(argv);
  if (root === resolve("/") || root === realpathSync.native(homedir())) {
    console.error(`mcp-tailwind-a11y: warning: the project root is ${root}, so every .jsx/.tsx file under it can be read and every Tailwind config found there is run. Use --root to point at one project.`);
  }

  const server = createServer({ root, version });
  // The SDK closes the transport without a word on a protocol-level fault, such
  // as a message over its size limit; this is the only place that shows up.
  server.server.onerror = (err) => console.error(`mcp-tailwind-a11y: ${err.message}`);
  await server.connect(new StdioServerTransport(process.stdin, protectStdout()));
  console.error(`mcp-tailwind-a11y ${version} ready (root: ${root})`);
}

main().catch((err) => fail((err as Error).message));
