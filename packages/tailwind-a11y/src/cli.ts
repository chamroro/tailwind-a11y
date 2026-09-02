#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import fg from "fast-glob";
import { extractChecks, extractContrastSkips } from "./parser/extractClasses.js";
import { checkContrast, checkContrastValueSkips, type ContrastViolation } from "./rules/checkContrast.js";
import { extractTouchTargetChecks, extractTouchTargetSkips } from "./parser/extractTouchTargets.js";
import { checkTouchTargets, type TouchTargetViolation } from "./rules/checkTouchTarget.js";
import { extractFocusIndicatorChecks } from "./parser/extractFocusIndicators.js";
import {
  checkFocusContrast,
  checkFocusIndicators,
  type FocusContrastViolation,
  type FocusIndicatorViolation,
} from "./rules/checkFocusIndicator.js";
import { extractReducedMotionChecks } from "./parser/extractReducedMotion.js";
import { checkReducedMotion, type ReducedMotionViolation } from "./rules/checkReducedMotion.js";
import { parseArgs, getHelpText } from "./cliArgs.js";
import { resolveTheme } from "./theme/loadCustomTheme.js";

// ../package.json resolves correctly from both src/ (dev) and dist/ (published).
const require = createRequire(import.meta.url);
const { version: packageVersion } = require("../package.json") as { version: string };

type AnyViolation =
  | ContrastViolation
  | TouchTargetViolation
  | FocusIndicatorViolation
  | FocusContrastViolation
  | ReducedMotionViolation;

interface Skip {
  file: string;
  line: number;
  reason: string;
}

function formatViolation(v: AnyViolation): string {
  switch (v.type) {
    case "contrast": {
      const base = `${v.line}: ${v.textClass} on ${v.bgClass} — ratio ${v.ratio.toFixed(2)}, needs ${v.required} (${v.level})`;
      return v.suggestion ? `${base}; try ${v.suggestion} (${v.suggestedRatio!.toFixed(2)})` : base;
    }
    case "touch-target": {
      const sc = v.level === "AAA" ? "2.5.5" : "2.5.8";
      return `${v.line}: <${v.tagName}> is ${v.widthPx}×${v.heightPx}px (${v.widthClass} ${v.heightClass}) — WCAG ${sc} requires >= ${v.required}×${v.required}px`;
    }
    case "focus-indicator":
      return `${v.line}: <${v.tagName}> removes the focus outline (${v.removalClass}) with no visible replacement (focus:ring-*/border-*/shadow-*/bg-*/outline-*)`;
    case "focus-contrast": {
      const sc = v.level === "AAA" ? "2.4.13" : "1.4.11";
      const base = `${v.line}: <${v.tagName}> focus indicator ${v.indicatorClass} on ${v.bgClass} — ratio ${v.ratio.toFixed(2)}, needs ${v.required} (WCAG ${sc})`;
      return v.thicknessPx !== undefined
        ? `${base}; also only ${v.thicknessPx}px thick, needs >= ${v.requiredThicknessPx}px`
        : base;
    }
    case "reduced-motion":
      return v.mechanism === "animate"
        ? `${v.line}: <${v.tagName}> animates ${v.motionClass} via a CSS animation with no motion-reduce:animate-none guard — WCAG 2.3.3 requires motion animation triggered by interaction to be disableable`
        : `${v.line}: <${v.tagName}> animates ${v.motionClass} via ${v.transitionClass} with no motion-reduce:transition-none/transform-none guard — WCAG 2.3.3 requires motion animation triggered by interaction to be disableable`;
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
  const { help, version, verbose, strict, config, configError: usageError, patterns } = parseArgs(process.argv.slice(2));

  if (help) {
    console.log(getHelpText());
    return;
  }
  if (version) {
    console.log(packageVersion);
    return;
  }
  if (usageError) {
    console.error(`tailwind-a11y: ${usageError}`);
    process.exitCode = 1;
    return;
  }

  const { palette, spacing, configError } = resolveTheme({
    rootDir: process.cwd(),
    configPath: config ? resolve(process.cwd(), config) : null,
  });
  if (configError) {
    console.warn(`tailwind-a11y: ${configError}`);
  }

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
      const focusChecks = extractFocusIndicatorChecks(code, file);

      violations.push(
        ...checkContrast(contrastChecks, palette),
        ...checkTouchTargets(extractTouchTargetChecks(code, file, spacing), strict),
        ...checkFocusIndicators(focusChecks),
        ...checkFocusContrast(focusChecks, strict, palette),
        ...checkReducedMotion(extractReducedMotionChecks(code, file), strict)
      );

      if (verbose) {
        skips.push(
          ...extractContrastSkips(code, file),
          ...checkContrastValueSkips(contrastChecks, palette),
          ...extractTouchTargetSkips(code, file, spacing)
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
