#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import fg from "fast-glob";
import { extractChecks, extractContrastSkips } from "./parser/extractClasses.js";
import { checkContrast, checkContrastValueSkips, type ContrastViolation } from "./rules/checkContrast.js";
import { extractTouchTargetChecks, extractTouchTargetSkips } from "./parser/extractTouchTargets.js";
import { checkTouchTargets, type TouchTargetViolation } from "./rules/checkTouchTarget.js";
import { extractFocusIndicatorChecks } from "./parser/extractFocusIndicators.js";
import { checkFocusIndicators, type FocusIndicatorViolation } from "./rules/checkFocusIndicator.js";

type AnyViolation = ContrastViolation | TouchTargetViolation | FocusIndicatorViolation;

interface Skip {
  file: string;
  line: number;
  reason: string;
}

function formatViolation(v: AnyViolation): string {
  switch (v.type) {
    case "contrast":
      return `${v.line}: ${v.textClass} on ${v.bgClass} — ratio ${v.ratio.toFixed(2)}, needs ${v.required} (${v.level})`;
    case "touch-target":
      return `${v.line}: <${v.tagName}> is ${v.widthPx}×${v.heightPx}px (${v.widthClass} ${v.heightClass}) — WCAG 2.5.8 requires >= 24×24px`;
    case "focus-indicator":
      return `${v.line}: <${v.tagName}> removes the focus outline (${v.removalClass}) with no visible replacement (focus:ring-*/border-*/shadow-*/bg-*/outline-*)`;
  }
}

function groupByFile<T extends { file: string }>(items: T[]): Map<string, T[]> {
  const byFile = new Map<string, T[]>();
  for (const item of items) {
    const existing = byFile.get(item.file);
    if (existing) {
      existing.push(item);
    } else {
      byFile.set(item.file, [item]);
    }
  }
  return byFile;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose") || args.includes("-v");
  const patterns = args.filter((a) => a !== "--verbose" && a !== "-v");
  const globPatterns = patterns.length > 0 ? patterns : ["**/*.{jsx,tsx}"];

  const files = await fg(globPatterns, {
    cwd: process.cwd(),
    absolute: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/build/**"],
  });

  const violations: AnyViolation[] = [];
  const skips: Skip[] = [];

  for (const absPath of files) {
    // Display/report path is project-root-relative (e.g. "/src/App.tsx"),
    // not the full absolute path — reading still uses the absolute path,
    // which is unambiguous regardless of process.cwd() quirks.
    const file = "/" + relative(process.cwd(), absPath).split(sep).join("/");

    try {
      const code = readFileSync(absPath, "utf8");
      const contrastChecks = extractChecks(code, file);

      violations.push(
        ...checkContrast(contrastChecks),
        ...checkTouchTargets(extractTouchTargetChecks(code, file)),
        ...checkFocusIndicators(extractFocusIndicatorChecks(code, file))
      );

      if (verbose) {
        skips.push(
          ...extractContrastSkips(code, file),
          ...checkContrastValueSkips(contrastChecks),
          ...extractTouchTargetSkips(code, file)
        );
      }
    } catch (err) {
      // Consistent with the parser's own skip-on-unparsable-file behavior:
      // one unreadable file (permissions, deleted between glob and read)
      // shouldn't abort the whole scan.
      console.warn(`tailwind-a11y: skipping unreadable file ${file}: ${(err as Error).message}`);
    }
  }

  if (violations.length === 0) {
    console.log("No accessibility issues found.");
  } else {
    const byFile = groupByFile(violations);
    for (const [file, fileViolations] of byFile) {
      console.log(file);
      for (const v of fileViolations) {
        console.log(`  ${formatViolation(v)}`);
      }
    }
    console.log(`\n${violations.length} issue(s) in ${byFile.size} file(s)`);
  }

  if (verbose && skips.length > 0) {
    console.log(`\n--- Skipped (${skips.length}) — not checked, not a pass ---`);
    const byFile = groupByFile(skips);
    for (const [file, fileSkips] of byFile) {
      console.log(file);
      for (const s of fileSkips) {
        console.log(`  ${s.line}: ${s.reason}`);
      }
    }
  }

  if (violations.length > 0) {
    process.exitCode = 1;
  }
}

main();
