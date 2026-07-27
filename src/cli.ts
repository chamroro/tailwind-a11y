#!/usr/bin/env node
import { readFileSync } from "node:fs";
import fg from "fast-glob";
import { extractChecks } from "./parser/extractClasses.js";
import { checkContrast, type ContrastViolation } from "./rules/checkContrast.js";
import { extractTouchTargetChecks } from "./parser/extractTouchTargets.js";
import { checkTouchTargets, type TouchTargetViolation } from "./rules/checkTouchTarget.js";
import { extractFocusIndicatorChecks } from "./parser/extractFocusIndicators.js";
import { checkFocusIndicators, type FocusIndicatorViolation } from "./rules/checkFocusIndicator.js";

type AnyViolation = ContrastViolation | TouchTargetViolation | FocusIndicatorViolation;

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const patterns = args.length > 0 ? args : ["**/*.{jsx,tsx}"];

  const files = await fg(patterns, {
    cwd: process.cwd(),
    absolute: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/build/**"],
  });

  const violations: AnyViolation[] = files.flatMap((file) => {
    try {
      const code = readFileSync(file, "utf8");
      return [
        ...checkContrast(extractChecks(code, file)),
        ...checkTouchTargets(extractTouchTargetChecks(code, file)),
        ...checkFocusIndicators(extractFocusIndicatorChecks(code, file)),
      ];
    } catch (err) {
      // Consistent with the parser's own skip-on-unparsable-file behavior:
      // one unreadable file (permissions, deleted between glob and read)
      // shouldn't abort the whole scan.
      console.warn(`tailwind-a11y: skipping unreadable file ${file}: ${(err as Error).message}`);
      return [];
    }
  });

  if (violations.length === 0) {
    console.log("No accessibility issues found.");
    return;
  }

  const byFile = new Map<string, AnyViolation[]>();
  for (const violation of violations) {
    const existing = byFile.get(violation.file);
    if (existing) {
      existing.push(violation);
    } else {
      byFile.set(violation.file, [violation]);
    }
  }

  for (const [file, fileViolations] of byFile) {
    console.log(file);
    for (const v of fileViolations) {
      console.log(`  ${formatViolation(v)}`);
    }
  }

  console.log(`\n${violations.length} issue(s) in ${byFile.size} file(s)`);
  process.exitCode = 1;
}

main();
