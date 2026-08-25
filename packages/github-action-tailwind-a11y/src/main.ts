import { appendFileSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import fg from "fast-glob";
import {
  extractChecks,
  checkContrast,
  extractTouchTargetChecks,
  checkTouchTargets,
  extractFocusIndicatorChecks,
  checkFocusIndicators,
  checkFocusContrast,
  extractReducedMotionChecks,
  checkReducedMotion,
  resolveTheme,
} from "tailwind-a11y";
import { parseInputs } from "./inputs.js";
import { formatViolation, toAnnotationCommand, MAX_ANNOTATIONS, type AnyViolation } from "./annotations.js";

function groupByFile(violations: AnyViolation[]): Map<string, AnyViolation[]> {
  const byFile = new Map<string, AnyViolation[]>();
  for (const v of violations) {
    const existing = byFile.get(v.file);
    if (existing) {
      existing.push(v);
    } else {
      byFile.set(v.file, [v]);
    }
  }
  return byFile;
}

async function main(): Promise<void> {
  const { patterns, config, failOnViolations, strict } = parseInputs(process.env);

  // The runner launches this process with cwd = GITHUB_WORKSPACE (the
  // consumer's checkout), so process.cwd() is the right root for globbing,
  // config auto-detection, and repo-relative annotation paths alike.
  const cwd = process.cwd();

  const { palette, spacing, configError } = resolveTheme({
    rootDir: cwd,
    configPath: config ? resolve(cwd, config) : null,
  });
  if (configError) {
    console.log(`::warning title=tailwind-a11y::${configError}`);
  }

  const files = await fg(patterns, {
    cwd,
    absolute: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/build/**"],
  });

  const violations: AnyViolation[] = [];

  for (const absPath of files) {
    // Annotation file paths must be repo-relative with forward slashes and
    // NO leading slash -- GitHub silently drops the annotation otherwise
    // (unlike cli.ts, which prefixes "/" purely for display).
    const file = relative(cwd, absPath).split(sep).join("/");

    try {
      const code = readFileSync(absPath, "utf8");
      const focusChecks = extractFocusIndicatorChecks(code, file);
      violations.push(
        ...checkContrast(extractChecks(code, file), palette),
        ...checkTouchTargets(extractTouchTargetChecks(code, file, spacing), strict),
        ...checkFocusIndicators(focusChecks),
        ...checkFocusContrast(focusChecks, strict, palette),
        ...checkReducedMotion(extractReducedMotionChecks(code, file), strict)
      );
    } catch (err) {
      console.log(`tailwind-a11y: skipping unreadable file ${file}: ${(err as Error).message}`);
    }
  }

  if (violations.length === 0) {
    console.log(`No accessibility issues found in ${files.length} file(s).`);
    return;
  }

  // Inline annotations, capped -- GitHub renders ~10 per type per step.
  for (const v of violations.slice(0, MAX_ANNOTATIONS)) {
    console.log(toAnnotationCommand(v));
  }
  if (violations.length > MAX_ANNOTATIONS) {
    console.log(
      `::warning title=tailwind-a11y::${violations.length - MAX_ANNOTATIONS} more violation(s) not shown as inline annotations -- see the log and job summary for the full list`
    );
  }

  // The full list always goes to the plain log, same shape as the CLI.
  const byFile = groupByFile(violations);
  for (const [file, fileViolations] of byFile) {
    console.log(file);
    for (const v of fileViolations) {
      console.log(`  ${v.line}: ${formatViolation(v)}`);
    }
  }
  console.log(`\n${violations.length} issue(s) in ${byFile.size} file(s)`);

  // And a markdown table to the job summary page, which has no annotation cap.
  const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
  if (summaryPath) {
    const rows = violations.map((v) => `| ${v.file} | ${v.line} | ${formatViolation(v)} |`).join("\n");
    appendFileSync(
      summaryPath,
      `## tailwind-a11y: ${violations.length} issue(s) in ${byFile.size} file(s)\n\n| File | Line | Issue |\n|---|---|---|\n${rows}\n`
    );
  }

  if (failOnViolations) {
    process.exitCode = 1;
  }
}

main();
