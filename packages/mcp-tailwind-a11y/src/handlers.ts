import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  analyzeSource,
  findTailwindConfig,
  findTailwindThemeCss,
  formatViolation,
  resolveTheme,
  wcagCriterion,
  type AnalysisResult,
} from "tailwind-a11y";

export const MAX_SOURCE_BYTES = 1_000_000;
// Total source bytes one check_tailwind_a11y_files call will read. Without it
// 50 files of the per-file limit is 50 MB parsed synchronously, which blocks
// the server (and every other request) for the better part of a minute.
export const MAX_CALL_BYTES = 5_000_000;
export const MAX_PATHS = 50;
// A 1 MB source can produce tens of thousands of violations; the response has
// to stay small enough for a model to read, so lists are cut here and the
// result says so, with the true totals in the summary.
export const MAX_REPORTED = 200;

const CHECKABLE_EXTENSIONS = new Set([".jsx", ".tsx"]);
// A Tailwind JS config is loaded with require(), i.e. executed; a CSS theme is
// only parsed. Compared case-sensitively because the engine decides which of
// the two a path is by an exact ".css" suffix: letting ".CSS" through would
// have it executed as JavaScript.
const CONFIG_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".css"]);

// A problem with what the caller asked for, worded for the caller (an agent)
// to act on -- as opposed to an unexpected failure.
export class UserError extends Error {}

export interface ViolationReport {
  line: number;
  wcag: string;
  type: string;
  message: string;
  details: Record<string, unknown>;
}

export interface SkipReport {
  line: number;
  reason: string;
}

export interface SourceReport {
  file: string;
  // false means nothing in this file was checked -- not that it is clean.
  parsed: boolean;
  // Full counts; the lists below stop at MAX_REPORTED.
  violationCount: number;
  skippedCount: number;
  violations: ViolationReport[];
  skipped: SkipReport[];
  error?: string;
}

export interface CheckInput {
  code: string;
  filePath?: string;
  strict?: boolean;
  configPath?: string;
}

export interface CheckResult {
  summary: { parsed: boolean; violations: number; skipped: number; truncated: boolean };
  violations: ViolationReport[];
  skipped: SkipReport[];
  warnings: string[];
}

export interface CheckFilesInput {
  paths: string[];
  strict?: boolean;
  configPath?: string;
}

export interface CheckFilesResult {
  summary: { files: number; checked: number; unchecked: number; violations: number; skipped: number; truncated: boolean };
  files: SourceReport[];
  warnings: string[];
}

export interface HandlerContext {
  // Fixed by whoever starts the server, never by a tool argument: a JS Tailwind
  // config under this directory gets executed to read its theme.
  root: string;
}

// realpath.native, not the JS realpath: on a case-insensitive filesystem only
// the native one reports a path in its real case, and the inside-the-root test
// below compares paths exactly.
const realpath = realpathSync.native;

// True when the target lies inside the root. Compared as relative path
// segments rather than a string prefix, so a sibling directory such as
// `<root>-other` doesn't pass, while a directory literally named `..foo`
// inside the root still does.
function isInside(realRoot: string, realTarget: string): boolean {
  const rel = relative(realRoot, realTarget);
  if (rel === "") return false;
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

// Resolves a path against the root and refuses anything that ends up outside
// it once symlinks are followed.
function resolveInsideRoot(root: string, requested: string): string {
  const realRoot = realpath(root);
  const refusal = new UserError(`refused: ${requested} is outside the project root`);

  // First as plain path arithmetic, before touching the filesystem: a path
  // that lexically leaves the root gets the same answer whether or not the
  // file exists, so the error can't be used to probe what exists elsewhere.
  if (!isInside(realRoot, resolve(realRoot, requested))) throw refusal;

  let real: string;
  try {
    real = realpath(resolve(realRoot, requested));
  } catch {
    throw new UserError(`file not found: ${requested}`);
  }
  // Then again with symlinks followed, for a link inside the root that points out of it.
  if (!isInside(realRoot, real)) throw refusal;
  return real;
}

function checkConfigExtension(path: string, shown: string): void {
  if (!CONFIG_EXTENSIONS.has(extname(path))) {
    throw new UserError(`configPath must be a .js, .cjs, .mjs or .css file: ${shown}`);
  }
}

// Every config the engine is about to load goes through here, the explicit
// configPath and the auto-detected one alike: a symlink inside the root that
// points outside must not get a different answer depending on how it was found.
function loadTheme(ctx: HandlerContext, configPath: string | undefined) {
  const warnings: string[] = [];
  let explicit: string | null = null;

  if (configPath !== undefined) {
    checkConfigExtension(configPath, configPath);
    explicit = resolveInsideRoot(ctx.root, configPath);
    checkConfigExtension(explicit, configPath); // a ".css" link to a ".js" is judged by what it resolves to
  } else {
    const found = findTailwindConfig(ctx.root) ?? findTailwindThemeCss(ctx.root);
    if (found) {
      try {
        explicit = resolveInsideRoot(ctx.root, found);
      } catch {
        warnings.push("Ignored a Tailwind config that resolves to outside the project root; using the default theme.");
      }
    }
  }

  if (explicit === null) {
    const theme = resolveTheme({ rootDir: null });
    return { palette: theme.palette, spacing: theme.spacing, warnings };
  }
  const theme = resolveTheme({ rootDir: ctx.root, configPath: explicit });
  // The engine's message carries the absolute path; report it relative to the root.
  if (theme.configError) {
    warnings.push(`Could not load the Tailwind config /${relative(realpath(ctx.root), explicit).split(sep).join("/")}; using the default theme.`);
  }
  return { palette: theme.palette, spacing: theme.spacing, warnings };
}

function toReport(file: string, result: AnalysisResult): SourceReport {
  const violations = result.violations.map((v) => ({
    line: v.line,
    wcag: wcagCriterion(v),
    type: v.type,
    message: formatViolation(v),
    details: { ...v },
  }));
  return {
    file,
    parsed: result.parsed,
    violationCount: violations.length,
    skippedCount: result.skips.length,
    violations: violations.slice(0, MAX_REPORTED),
    skipped: result.skips.slice(0, MAX_REPORTED),
    ...(result.parsed ? {} : { error: "could not be parsed as JSX/TSX; nothing was checked (this is not a pass)" }),
  };
}

// analyzeSource handles unparsable source but not an extractor throwing, and a
// long-lived server must not die on one bad input.
function analyzeOne(code: string, file: string, options: Parameters<typeof analyzeSource>[2]): SourceReport {
  try {
    return toReport(file, analyzeSource(code, file, { ...options, includeSkips: true }));
  } catch (err) {
    return {
      file,
      parsed: false,
      violationCount: 0,
      skippedCount: 0,
      violations: [],
      skipped: [],
      error: `analysis failed: ${(err as Error).message}`,
    };
  }
}

export function checkCode(input: CheckInput, ctx: HandlerContext): CheckResult {
  if (Buffer.byteLength(input.code, "utf8") > MAX_SOURCE_BYTES) {
    throw new UserError(`code is larger than ${MAX_SOURCE_BYTES} bytes; check it as a file instead`);
  }
  const theme = loadTheme(ctx, input.configPath);
  const report = analyzeOne(input.code, input.filePath ?? "snippet.tsx", {
    strict: input.strict ?? false,
    palette: theme.palette,
    spacing: theme.spacing,
  });

  const warnings = [...theme.warnings];
  if (report.error) warnings.push(report.error.startsWith("analysis failed") ? report.error : `The code ${report.error}.`);
  const truncated = report.violationCount > report.violations.length || report.skippedCount > report.skipped.length;
  if (truncated) {
    warnings.push(`Only the first ${MAX_REPORTED} violations and skipped elements are listed; summary has the full counts.`);
  }

  return {
    summary: { parsed: report.parsed, violations: report.violationCount, skipped: report.skippedCount, truncated },
    violations: report.violations,
    skipped: report.skipped,
    warnings,
  };
}

function readCheckableFile(ctx: HandlerContext, requested: string): { display: string; code: string; bytes: number } {
  if (!CHECKABLE_EXTENSIONS.has(extname(requested).toLowerCase())) {
    throw new UserError(`only .jsx and .tsx files are checked: ${requested}`);
  }
  const real = resolveInsideRoot(ctx.root, requested);
  const stats = statSync(real);
  if (!stats.isFile()) throw new UserError(`not a file: ${requested}`);
  if (stats.size > MAX_SOURCE_BYTES) {
    throw new UserError(`${requested} is larger than ${MAX_SOURCE_BYTES} bytes`);
  }
  const display = "/" + relative(realpath(ctx.root), real).split(sep).join("/");
  return { display, code: readFileSync(real, "utf8"), bytes: stats.size };
}

export function checkFiles(input: CheckFilesInput, ctx: HandlerContext): CheckFilesResult {
  if (input.paths.length > MAX_PATHS) {
    throw new UserError(`at most ${MAX_PATHS} paths per call`);
  }
  const theme = loadTheme(ctx, input.configPath);

  let bytesRead = 0;
  let listedViolations = 0;

  const files: SourceReport[] = input.paths.map((requested) => {
    try {
      const { display, code, bytes } = readCheckableFile(ctx, requested);
      if (bytesRead + bytes > MAX_CALL_BYTES) {
        throw new UserError(`not checked: this call already read ${MAX_CALL_BYTES} bytes; check the rest in a separate call`);
      }
      bytesRead += bytes;
      const report = analyzeOne(code, display, { strict: input.strict ?? false, palette: theme.palette, spacing: theme.spacing });
      // One shared budget across the files, not MAX_REPORTED each: fifty files
      // at the per-file limit would still be an unreadably large response.
      const room = Math.max(0, MAX_REPORTED - listedViolations);
      report.violations = report.violations.slice(0, room);
      listedViolations += report.violations.length;
      return report;
    } catch (err) {
      // One refused or unreadable path must not hide the results for the rest.
      // The Node error code is reported, not its message, which carries an absolute path.
      const code = (err as NodeJS.ErrnoException).code;
      return {
        file: requested,
        parsed: false,
        violationCount: 0,
        skippedCount: 0,
        violations: [],
        skipped: [],
        error: err instanceof UserError ? err.message : `could not read ${requested}${code ? ` (${code})` : ""}`,
      };
    }
  });

  const checked = files.filter((f) => f.parsed && !f.error).length;
  const truncated = files.some((f) => f.violationCount > f.violations.length || f.skippedCount > f.skipped.length);
  const warnings = [...theme.warnings];
  if (truncated) {
    warnings.push(`Only the first ${MAX_REPORTED} violations across all files are listed; each file's violationCount has its full count.`);
  }

  return {
    summary: {
      files: files.length,
      checked,
      unchecked: files.length - checked,
      violations: files.reduce((n, f) => n + f.violationCount, 0),
      skipped: files.reduce((n, f) => n + f.skippedCount, 0),
      truncated,
    },
    files,
    warnings,
  };
}
