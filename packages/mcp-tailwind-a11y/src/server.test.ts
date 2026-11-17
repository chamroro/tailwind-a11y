import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "./createServer.js";

const LOW_CONTRAST = `const C = () => <p className="text-gray-400 bg-white">x</p>;`;

let root: string;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "mcp-a11y-srv-")));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "Card.tsx"), LOW_CONTRAST);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

async function connect() {
  const server = createServer({ root, version: "0.0.0-test" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

describe("server over an in-memory transport", () => {
  it("lists both tools, marked read-only", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["check_tailwind_a11y", "check_tailwind_a11y_files"]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true, openWorldHint: false });
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it("requires code, and bounds the number of paths, in the input schemas", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const code = tools.find((t) => t.name === "check_tailwind_a11y")!;
    const files = tools.find((t) => t.name === "check_tailwind_a11y_files")!;
    expect(code.inputSchema.required).toEqual(["code"]);
    expect(files.inputSchema.required).toEqual(["paths"]);
    expect((files.inputSchema.properties as any).paths).toMatchObject({ minItems: 1, maxItems: 50 });
  });

  it("round-trips a check, with structured content that matches the text content", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "check_tailwind_a11y", arguments: { code: LOW_CONTRAST } });
    expect(result.isError).toBe(false);
    const structured = result.structuredContent as any;
    expect(structured.summary).toEqual({ parsed: true, violations: 1, skipped: 0, truncated: false });
    expect(structured.violations[0]).toMatchObject({ wcag: "1.4.3", type: "contrast" });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual(structured);
  });

  it("returns an error, not a clean result, for code that cannot be parsed", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "check_tailwind_a11y", arguments: { code: "const x = {{{ nope" } });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as any).summary.parsed).toBe(false);
  });

  it("checks files from disk, and is an error only when none could be checked", async () => {
    const client = await connect();
    const ok = await client.callTool({
      name: "check_tailwind_a11y_files",
      arguments: { paths: ["src/Card.tsx", "src/missing.tsx"] },
    });
    expect(ok.isError).toBe(false);
    expect((ok.structuredContent as any).summary).toMatchObject({ files: 2, checked: 1, violations: 1 });

    const none = await client.callTool({ name: "check_tailwind_a11y_files", arguments: { paths: ["src/missing.tsx"] } });
    expect(none.isError).toBe(true);
  });

  it("reports a refused request as a tool error the caller can read", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "check_tailwind_a11y",
      arguments: { code: LOW_CONTRAST, configPath: "../elsewhere.cjs" },
    });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toMatch(/outside the project root/);
  });

  it("rejects arguments that break the input schema before reaching a handler", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "check_tailwind_a11y_files", arguments: { paths: [] } }).catch((e) => e);
    // Depending on the SDK version a schema failure surfaces as a rejected call or as an error result.
    const failed = result instanceof Error || (result as { isError?: boolean }).isError === true;
    expect(failed).toBe(true);
  });
});

// Everything below runs the built bin as a real child process, so
// `npm run build` has to come first -- the same order the ESLint plugin's tests
// already rely on for the engine's dist.
const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "server.js");

beforeAll(() => {
  if (!existsSync(bin)) {
    throw new Error(`${bin} does not exist: run \`npm run build -w mcp-tailwind-a11y\` before the tests.`);
  }
});

// Talks raw JSON-RPC to the server and records exactly what reaches stdout.
// An SDK client is no use for this: it silently drops any stdout line that is
// not JSON, which is the very thing being tested for.
function runRaw(serverRoot: string, requests: object[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, "--root", serverRoot], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
    // Closing stdin ends the session once the server has answered everything.
    setTimeout(() => child.stdin.end(), 1500);
  });
}

const HANDSHAKE = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
];
const call = (id: number, args: object) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: "check_tailwind_a11y", arguments: args },
});

describe("the built server over stdio", () => {
  it("completes a real client session through the SDK", async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [bin, "--root", root], stderr: "pipe" });
    const client = new Client({ name: "stdio-test", version: "0" });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools).toHaveLength(2);
      const result = await client.callTool({ name: "check_tailwind_a11y", arguments: { code: LOW_CONTRAST } });
      expect(result.isError).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("writes nothing but JSON-RPC to stdout, including the engine's warnings on unparsable code", async () => {
    const { stdout, stderr } = await runRaw(root, [...HANDSHAKE, call(2, { code: LOW_CONTRAST }), call(3, { code: "const x = {{{" })]);
    const lines = stdout.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) expect(() => JSON.parse(line), `stdout line is not JSON: ${line}`).not.toThrow();
    expect(stderr).toContain("skipping unparsable file"); // the warning went to stderr instead
  });

  describe("when the project's Tailwind config writes to stdout", () => {
    let noisyRoot: string;
    beforeAll(() => {
      noisyRoot = realpathSync(mkdtempSync(join(tmpdir(), "mcp-a11y-noisy-")));
      // A line, and a partial write with no newline: the latter would glue
      // itself onto the front of the next JSON-RPC response.
      writeFileSync(
        join(noisyRoot, "tailwind.config.cjs"),
        `console.log("CONFIG-LOG"); process.stdout.write("PARTIAL-NO-NEWLINE"); console.info("CONFIG-INFO"); module.exports = {};`
      );
    });
    afterAll(() => rmSync(noisyRoot, { recursive: true, force: true }));

    it("keeps stdout protocol-only and sends the noise to stderr", async () => {
      const { stdout, stderr } = await runRaw(noisyRoot, [...HANDSHAKE, call(2, { code: LOW_CONTRAST }), call(3, { code: LOW_CONTRAST })]);
      const lines = stdout.split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(3);
      for (const line of lines) expect(() => JSON.parse(line), `stdout line is not JSON: ${line}`).not.toThrow();
      expect(stdout).not.toContain("CONFIG-LOG");
      expect(stdout).not.toContain("PARTIAL-NO-NEWLINE");
      expect(stderr).toContain("CONFIG-LOG");
      expect(stderr).toContain("PARTIAL-NO-NEWLINE");
      // And the check itself still worked through all that.
      const answers = lines.map((l) => JSON.parse(l)).filter((m) => m.id === 2 || m.id === 3);
      expect(answers.every((m) => m.result?.isError === false)).toBe(true);
    });
  });

  describe("startup", () => {
    it.each([
      ["a root that does not exist", ["--root", "/no/such/dir"], /does not exist/],
      ["a root that is a file", ["--root", fileURLToPath(import.meta.url)], /not a directory/],
      ["an empty --root=", ["--root="], /needs a directory/],
      ["--root with no value", ["--root"], /needs a directory/],
      ["an unknown argument", ["--nope"], /unknown argument/],
    ])("refuses %s with exit code 1 and a message on stderr", async (_label, args, message) => {
      const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
        const child = spawn(process.execPath, [bin, ...args], { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        child.on("close", (code) => resolve({ stdout, stderr, code }));
      });
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(message);
    });

    it("prints --version and --help on stdout and exits without starting a server", async () => {
      for (const flag of ["--version", "--help"]) {
        const out = await new Promise<string>((resolve) => {
          const child = spawn(process.execPath, [bin, flag], { stdio: ["ignore", "pipe", "pipe"] });
          let stdout = "";
          child.stdout.on("data", (d) => (stdout += d));
          child.on("close", () => resolve(stdout));
        });
        expect(out.length).toBeGreaterThan(0);
      }
    });
  });
});
