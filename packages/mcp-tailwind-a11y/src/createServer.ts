import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  MAX_PATHS,
  MAX_REPORTED,
  MAX_SOURCE_BYTES,
  UserError,
  checkCode,
  checkFiles,
  type CheckFilesInput,
  type CheckInput,
  type HandlerContext,
} from "./handlers.js";

const violation = z.object({
  line: z.number(),
  wcag: z.string().describe("WCAG success criterion, e.g. 1.4.3"),
  type: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).describe("The raw check result, e.g. ratio, suggestion, suggestedRatio"),
});
const skipped = z.object({ line: z.number(), reason: z.string() });

const INSTRUCTIONS = [
  "Checks Tailwind CSS class combinations in React (JSX/TSX) code for WCAG accessibility violations:",
  "color contrast, touch target size, focus indicators and reduced motion.",
  "Call it after writing or editing UI code, then fix what it reports and call it again.",
  'An empty "violations" list is NOT a pass by itself: read "skipped" (elements that were not checked, for',
  "example a className built with cn(), clsx() or a template literal) and \"warnings\" before telling anyone the code is accessible.",
].join(" ");

const readOnly = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false };

function respond<T extends object>(run: () => T, failed: (result: T) => boolean) {
  try {
    const result = run();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as Record<string, unknown>,
      isError: failed(result),
    };
  } catch (err) {
    const text = err instanceof UserError ? err.message : `unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text" as const, text }], isError: true };
  }
}

export function createServer(options: { root: string; version: string }): McpServer {
  const ctx: HandlerContext = { root: options.root };
  const server = new McpServer(
    { name: "tailwind-a11y", version: options.version },
    // The input schemas are validated element by element before .max() is
    // evaluated, so without this a huge array is validated in full first
    // (GHSA-mrhx-c7xc-m3w5 class of memory exhaustion).
    { instructions: INSTRUCTIONS, maxToolInputElements: 1000 }
  );

  server.registerTool(
    "check_tailwind_a11y",
    {
      title: "Check Tailwind accessibility (code)",
      description:
        "Check a JSX/TSX snippet's Tailwind classes for WCAG violations. Returns each violation with its WCAG criterion, " +
        "a message, and for contrast a suggested class that passes. Also returns 'skipped' (elements it could not " +
        "check, such as a className built with cn()/clsx()) and 'warnings'. If the code cannot be parsed, nothing is " +
        "checked and the result is an error, not a pass. Use check_tailwind_a11y_files instead when the code is " +
        "already in a file.",
      inputSchema: {
        code: z.string().max(MAX_SOURCE_BYTES).describe("The JSX/TSX source to check."),
        filePath: z.string().max(500).optional().describe("Label used in results. Defaults to snippet.tsx."),
        strict: z
          .boolean()
          .optional()
          .describe("Also enforce the AAA tier: 44px touch targets, 2px focus indicators, reduced motion. Default false."),
        configPath: z
          .string()
          .max(500)
          .optional()
          .describe("Tailwind config (.js/.cjs/.mjs/.css) inside the project root. Default: auto-detected."),
      },
      outputSchema: {
        summary: z.object({
          parsed: z.boolean(),
          violations: z.number().describe("Full count, even when the list below is cut."),
          skipped: z.number(),
          truncated: z.boolean().describe(`True when the lists stop at ${MAX_REPORTED} entries.`),
        }),
        violations: z.array(violation),
        skipped: z.array(skipped),
        warnings: z.array(z.string()),
      },
      annotations: { title: "Check Tailwind accessibility (code)", ...readOnly },
    },
    (args) => respond(() => checkCode(args as CheckInput, ctx), (r) => !r.summary.parsed)
  );

  server.registerTool(
    "check_tailwind_a11y_files",
    {
      title: "Check Tailwind accessibility (files)",
      description:
        "Check .jsx/.tsx files under the project root for WCAG violations, reading them from disk so the code does " +
        "not have to be passed back in. Same results as check_tailwind_a11y, per file. A path outside the root, a " +
        "missing file or an unsupported extension is reported on that file without stopping the others; the call is " +
        "an error only when no file could be checked.",
      inputSchema: {
        paths: z
          .array(z.string().min(1).max(500))
          .min(1)
          .max(MAX_PATHS)
          .describe("File paths relative to the project root."),
        strict: z.boolean().optional().describe("Also enforce the AAA tier. Default false."),
        configPath: z
          .string()
          .max(500)
          .optional()
          .describe("Tailwind config (.js/.cjs/.mjs/.css) inside the project root. Default: auto-detected."),
      },
      outputSchema: {
        summary: z.object({
          files: z.number(),
          checked: z.number(),
          unchecked: z.number().describe("Files that were not checked (unreadable, refused, or unparsable). Not a pass."),
          violations: z.number(),
          skipped: z.number(),
          truncated: z.boolean(),
        }),
        files: z.array(
          z.object({
            file: z.string(),
            parsed: z.boolean(),
            violationCount: z.number(),
            skippedCount: z.number(),
            violations: z.array(violation),
            skipped: z.array(skipped),
            error: z.string().optional(),
          })
        ),
        warnings: z.array(z.string()),
      },
      annotations: { title: "Check Tailwind accessibility (files)", ...readOnly },
    },
    (args) => respond(() => checkFiles(args as CheckFilesInput, ctx), (r) => r.summary.checked === 0)
  );

  return server;
}
