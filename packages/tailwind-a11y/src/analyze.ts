import { parseJSX } from "./parser/babelInterop.js";
import { extractChecks, extractContrastSkips } from "./parser/extractClasses.js";
import { extractDynamicClassNameSkips } from "./parser/extractDynamicClassNameSkips.js";
import { extractFocusIndicatorChecks } from "./parser/extractFocusIndicators.js";
import { extractReducedMotionChecks } from "./parser/extractReducedMotion.js";
import { extractTouchTargetChecks, extractTouchTargetSkips } from "./parser/extractTouchTargets.js";
import { checkContrast, checkContrastValueSkips, type ContrastViolation } from "./rules/checkContrast.js";
import {
  checkFocusContrast,
  checkFocusIndicators,
  type FocusContrastViolation,
  type FocusIndicatorViolation,
} from "./rules/checkFocusIndicator.js";
import { checkReducedMotion, type ReducedMotionViolation } from "./rules/checkReducedMotion.js";
import { checkTouchTargets, type TouchTargetViolation } from "./rules/checkTouchTarget.js";
import { defaultPalette, type Palette } from "./theme/defaultPalette.js";
import { spacingScale } from "./theme/spacingScale.js";

export type AnyViolation =
  | ContrastViolation
  | TouchTargetViolation
  | FocusIndicatorViolation
  | FocusContrastViolation
  | ReducedMotionViolation;

export interface AnalysisSkip {
  line: number;
  reason: string;
}

export interface AnalysisResult {
  // false when the source couldn't be parsed as JSX/TSX: nothing was checked,
  // and the empty violations/skips below must not be read as "no issues".
  // true only means it *was* read -- an empty string, or a file with no JSX at
  // all, is parsed:true with nothing to report, which is a different situation
  // from "couldn't read it" (and the skips list is what says what the reader
  // could not look at inside a file that did parse).
  parsed: boolean;
  violations: AnyViolation[];
  skips: AnalysisSkip[];
}

export interface AnalyzeOptions {
  strict?: boolean;
  palette?: Palette;
  spacing?: Record<string, number>;
  // Skip reporting costs extra parses and is only wanted by callers that
  // surface "not checked" to a reader (CLI --verbose, an agent over MCP).
  includeSkips?: boolean;
}

// Runs every check over one source string, in the same order cli.ts, the VS
// Code adapter and the GitHub Action each inline today. Theme resolution is
// the caller's job: pass the palette/spacing from resolveTheme().
//
// Unparsable source is handled (parsed:false); anything else an extractor
// might throw is not. The CLI wraps each file in its own try/catch so one bad
// file can't abort a scan, and a long-lived caller (an MCP server, an editor)
// should do the same around this call rather than assume it never throws.
export function analyzeSource(code: string, file: string, options: AnalyzeOptions = {}): AnalysisResult {
  const { strict = false, palette = defaultPalette, spacing = spacingScale, includeSkips = false } = options;

  // parseJSX swallows syntax errors (it only warns on stderr and returns
  // null), so without this check unparsable code would come back as a clean
  // result -- the most dangerous misreading for an agent that just wrote it.
  if (parseJSX(code, file) === null) {
    return { parsed: false, violations: [], skips: [] };
  }

  const contrastChecks = extractChecks(code, file);
  const focusChecks = extractFocusIndicatorChecks(code, file);

  const violations: AnyViolation[] = [
    ...checkContrast(contrastChecks, palette),
    ...checkTouchTargets(extractTouchTargetChecks(code, file, spacing), strict),
    ...checkFocusIndicators(focusChecks),
    ...checkFocusContrast(focusChecks, strict, palette),
    ...checkReducedMotion(extractReducedMotionChecks(code, file), strict),
  ];

  const skips: AnalysisSkip[] = includeSkips
    ? [
        ...extractContrastSkips(code, file),
        ...checkContrastValueSkips(contrastChecks, palette),
        ...extractTouchTargetSkips(code, file, spacing),
        ...extractDynamicClassNameSkips(code, file),
      ]
        .map(({ line, reason }) => ({ line, reason }))
        .sort((a, b) => a.line - b.line)
    : [];

  return { parsed: true, violations, skips };
}

// The WCAG success criterion a violation is reported under. Levels decide
// the criterion for the two checks that have an AA and an AAA tier.
export function wcagCriterion(v: AnyViolation): string {
  switch (v.type) {
    case "contrast":
      return "1.4.3";
    case "touch-target":
      return v.level === "AAA" ? "2.5.5" : "2.5.8";
    case "focus-indicator":
      return "2.4.7";
    case "focus-contrast":
      return v.level === "AAA" ? "2.4.13" : "1.4.11";
    case "reduced-motion":
      return "2.3.3";
  }
}

// Human-readable message without a location prefix. Mirrors the wording of
// the CLI, the VS Code adapter and the GitHub Action, which still carry their
// own copies; moving them onto this one is a separate follow-up.
export function formatViolation(v: AnyViolation): string {
  switch (v.type) {
    case "contrast": {
      const base = `${v.textClass} on ${v.bgClass} — ratio ${v.ratio.toFixed(2)}, needs ${v.required} (${v.level})`;
      return v.suggestion ? `${base}; try ${v.suggestion} (${v.suggestedRatio!.toFixed(2)})` : base;
    }
    case "touch-target": {
      const sc = v.level === "AAA" ? "2.5.5" : "2.5.8";
      return `<${v.tagName}> is ${v.widthPx}×${v.heightPx}px (${v.widthClass} ${v.heightClass}) — WCAG ${sc} requires >= ${v.required}×${v.required}px`;
    }
    case "focus-indicator":
      return `<${v.tagName}> removes the focus outline (${v.removalClass}) with no visible replacement (focus:ring-*/border-*/shadow-*/bg-*/outline-*)`;
    case "focus-contrast": {
      const sc = v.level === "AAA" ? "2.4.13" : "1.4.11";
      const base = `<${v.tagName}> focus indicator ${v.indicatorClass} on ${v.bgClass} — ratio ${v.ratio.toFixed(2)}, needs ${v.required} (WCAG ${sc})`;
      return v.thicknessPx !== undefined
        ? `${base}; also only ${v.thicknessPx}px thick, needs >= ${v.requiredThicknessPx}px`
        : base;
    }
    case "reduced-motion":
      return v.mechanism === "animate"
        ? `<${v.tagName}> animates ${v.motionClass} via a CSS animation with no motion-reduce:animate-none guard — WCAG 2.3.3 requires motion animation triggered by interaction to be disableable`
        : `<${v.tagName}> animates ${v.motionClass} via ${v.transitionClass} with no motion-reduce:transition-none/transform-none guard — WCAG 2.3.3 requires motion animation triggered by interaction to be disableable`;
  }
}
