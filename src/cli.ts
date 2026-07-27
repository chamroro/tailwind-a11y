#!/usr/bin/env node
import { readFileSync } from "node:fs";
import fg from "fast-glob";
import { extractChecks } from "./parser/extractClasses.js";
import { checkContrast, type Violation } from "./rules/checkContrast.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const patterns = args.length > 0 ? args : ["**/*.{jsx,tsx}"];

  const files = await fg(patterns, {
    cwd: process.cwd(),
    absolute: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/build/**"],
  });

  const violations = files.flatMap((file) => {
    try {
      return checkContrast(extractChecks(readFileSync(file, "utf8"), file));
    } catch (err) {
      // Consistent with the parser's own skip-on-unparsable-file behavior:
      // one unreadable file (permissions, deleted between glob and read)
      // shouldn't abort the whole scan.
      console.warn(`tailwind-contrast-guard: skipping unreadable file ${file}: ${(err as Error).message}`);
      return [];
    }
  });

  if (violations.length === 0) {
    console.log("No contrast violations found.");
    return;
  }

  const byFile = new Map<string, Violation[]>();
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
      console.log(
        `  ${v.line}: ${v.textClass} on ${v.bgClass} — ratio ${v.ratio.toFixed(2)}, needs ${v.required} (${v.level})`
      );
    }
  }

  console.log(`\n${violations.length} violation(s) in ${byFile.size} file(s)`);
  process.exitCode = 1;
}

main();
