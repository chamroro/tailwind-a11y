import type { FocusIndicatorCheck } from "../parser/extractFocusIndicators.js";
import { COLOR_TOKEN } from "../parser/extractClasses.js";
import { resolveColorValue } from "./checkContrast.js";
import { contrastRatio, hexToRgb } from "../contrast/luminance.js";
import { defaultPalette } from "../theme/defaultPalette.js";
import type { Palette } from "../theme/defaultPalette.js";

export interface FocusIndicatorViolation {
  type: "focus-indicator";
  file: string;
  line: number;
  tagName: string;
  removalClass: string;
}

const REMOVAL_BASE = "outline-none";

// Utilities that match the "replacement" shape but are semantically no-ops —
// the same failure mode as bg-opacity-50 masking a real color match: a
// same-prefix decoy that would silently hide a real violation if we only
// checked the prefix. border-none/border-hidden only set border-style, not
// border-width -- verified against a real Tailwind v4 build that preflight
// resets every element to `border: 0 solid`, so border-width stays 0
// regardless of style and no border is ever drawn, same failure mode as
// border-0.
const DEGENERATE_BASES = new Set([
  "outline-none", "ring-0", "border-0", "shadow-none", "bg-transparent",
  "border-none", "border-hidden",
]);

// Modifier-only utilities (opacity/offset/inset) don't set a concrete value
// on their own — e.g. bg-opacity-50 with no bg-* color, or ring-offset-4
// with no ring-* width, renders nothing visible by itself. Same failure
// mode as DEGENERATE_BASES above, but suffix-shaped rather than a fixed
// set (opacity/offset take arbitrary numeric values), so matched with a
// pattern instead of enumerated.
const MODIFIER_ONLY = /^(bg|border|ring)-opacity-\d{1,3}$|^(ring|outline)-offset-\d{1,3}$|^ring-inset$/;

// Same failure mode again, one prefix-family level up: these utilities
// share the bg-*/border-* prefix but control layout/rendering *behavior*
// (attachment, repeat, size, clip, origin, position, table border mode),
// not a visible color/width/style that could replace a removed outline.
// Enumerated, not derived -- a future Tailwind utility sharing one of
// these prefixes without providing visible styling could reintroduce this
// gap, the same maintenance caveat as DEGENERATE_BASES/MODIFIER_ONLY above.
const NON_VISUAL_BASES = new Set([
  "bg-fixed", "bg-local", "bg-scroll",
  "bg-repeat", "bg-no-repeat", "bg-repeat-x", "bg-repeat-y", "bg-repeat-round", "bg-repeat-space",
  "bg-auto", "bg-cover", "bg-contain",
  "bg-clip-border", "bg-clip-padding", "bg-clip-content", "bg-clip-text",
  "bg-origin-border", "bg-origin-padding", "bg-origin-content",
  "bg-none",
  "bg-bottom", "bg-center", "bg-left", "bg-left-bottom", "bg-left-top",
  "bg-right", "bg-right-bottom", "bg-right-top", "bg-top",
  "border-collapse", "border-separate",
]);

// bg-blend-{mode} (e.g. bg-blend-multiply) sets a blend mode, not a color --
// suffix-varying like MODIFIER_ONLY above, so pattern-matched instead of
// enumerated. border-spacing-*/-x-*/-y-* sets the CSS border-spacing
// property, which only affects the gap between <table> cells -- verified
// against a real Tailwind v4 build that it has zero visual effect on any
// non-table element (the only elements this check ever fires on), even
// with a real numeric value applied.
const NON_VISUAL_PATTERN = /^bg-blend-|^border-spacing(-[xy])?-/;

// shadow-{color}/ring-{color} alone (e.g. shadow-red-500, ring-blue-400/50,
// an arbitrary hex) only sets the --tw-shadow-color/--tw-ring-color CSS
// variable -- the actual box-shadow property is set by a separate *size*
// utility (shadow-lg, ring-2, etc.) that references that variable. Verified
// against a real Tailwind v4 build: shadow-red-500 alone computes to
// `box-shadow: none`; shadow-lg shadow-red-500 together produce a real,
// colored shadow. Same underlying mechanism as MODIFIER_ONLY's opacity/
// offset cases above, but shaped like a color token rather than a fixed
// suffix, so it reuses COLOR_TOKEN (the exact same "is this a color value"
// test extractClasses.ts uses) instead of a third, drifting definition of
// what a color looks like.
function isColorOnlyShadowOrRing(base: string): boolean {
  const shadowMatch = /^shadow-(.+)$/.exec(base);
  if (shadowMatch && COLOR_TOKEN.test(shadowMatch[1])) return true;
  const ringMatch = /^ring-(.+)$/.exec(base);
  if (ringMatch && COLOR_TOKEN.test(ringMatch[1])) return true;
  return false;
}

function baseUtility(raw: string): string {
  return raw.slice(raw.lastIndexOf(":") + 1);
}

function isReplacement(raw: string): boolean {
  const base = baseUtility(raw);
  if (DEGENERATE_BASES.has(base) || MODIFIER_ONLY.test(base)) return false;
  if (NON_VISUAL_BASES.has(base) || NON_VISUAL_PATTERN.test(base)) return false;
  if (isColorOnlyShadowOrRing(base)) return false;
  return /^(ring|border|shadow|bg|outline)(-|$)/.test(base);
}

export function checkFocusIndicators(checks: FocusIndicatorCheck[]): FocusIndicatorViolation[] {
  const violations: FocusIndicatorViolation[] = [];

  for (const check of checks) {
    const removal = check.focusClasses.find((raw) => baseUtility(raw) === REMOVAL_BASE);
    if (!removal) continue;

    const hasReplacement = check.focusClasses.some(isReplacement);
    if (hasReplacement) continue;

    violations.push({
      type: "focus-indicator",
      file: check.file,
      line: check.line,
      tagName: check.tagName,
      removalClass: removal,
    });
  }

  return violations;
}

// --- Focus indicator contrast: WCAG 1.4.11 Non-text Contrast (AA) + 2.4.13
// Focus Appearance (AAA, under strict) -------------------------------------
//
// checkFocusIndicators above only asks "was the outline removed with
// nothing visible put back." It never looks at whether a present indicator
// is actually *visible* -- a real, silent miss: `focus:outline
// focus:outline-2 focus:outline-blue-400` on `bg-blue-500` reports zero
// violations today, even though blue-400-on-blue-500 is nowhere near a
// visible focus ring. 1.4.11 requires 3:1 contrast for UI-component state
// indicators (explicitly including focus indicators, per the W3C
// Understanding doc). 2.4.13 (AAA) does NOT raise that 3:1 -- it adds a
// second, independent minimum-thickness requirement (>= a 2 CSS pixel
// perimeter). `strict` here means "also enforce thickness," not "raise the
// contrast bar" -- unlike touch-target's AA/AAA, which move along the same
// axis, these are two different axes.

export interface FocusContrastViolation {
  type: "focus-contrast";
  file: string;
  line: number;
  tagName: string;
  indicatorClass: string;
  bgClass: string;
  ratio: number;
  required: number;
  // Reflects which SC this element actually fails, not just whether
  // `strict` is on: a contrast-only failure is a real 1.4.11/AA violation
  // whether or not strict is enabled, so it's always reported as "AA".
  // Only a thickness failure (only ever assessed under strict) is "AAA".
  level: "AA" | "AAA";
  thicknessPx?: number;
  requiredThicknessPx?: number;
}

// Flat non-text threshold -- not luminance.ts's requiredRatio()/meetsWCAG(),
// which model the text-specific large-text/small-text AA/AAA table that
// doesn't apply to UI-component contrast.
const NON_TEXT_MIN_RATIO = 3;

// WCAG 2.4.13's "2 CSS pixel thick perimeter" -- verified against a real
// tailwindcss@4.3.3 compile (see CLAUDE.md) rather than assumed.
const FOCUS_INDICATOR_MIN_THICKNESS_PX = 2;

// outline-{0,1,2,4,8} / ring-{0,1,2,4,8} -- Tailwind's fixed width scale for
// both utilities, verified against a real build. Bare `ring`/`outline` (no
// digit) is deliberately NOT in this map: verified via that same build that
// it resolves to 1px in Tailwind v4, but v3's bare `ring` default is
// documented elsewhere as 3px -- a real cross-version difference this tool
// can't currently distinguish, so bare ring/outline contributes color (if
// paired with an explicit color utility) but never a thickness value.
const WIDTH_SCALE: Record<string, number> = { "0": 0, "1": 1, "2": 2, "4": 4, "8": 8 };

// Near-duplicate of extractClasses.ts's lastColorToken, not a call to it:
// that function takes a single prefix ("text" | "bg") and this needs
// last-token-wins across *two* prefixes (outline-*, ring-*) in one pass, so
// whichever was actually written last in the class list wins regardless of
// which utility it is. Reuses COLOR_TOKEN (the one shared "is this
// color-shaped" test) and only excludes the "opacity" scale name locally --
// lastColorToken's full NON_COLOR_SCALE_NAMES set also excludes
// "linear"/"conic", but those are bg-gradient-angle utilities with no
// outline-*/ring-* equivalent, so they can never appear here.
function lastIndicatorColorToken(focusClasses: string[]): string | null {
  let found: string | null = null;
  for (const raw of focusClasses) {
    const base = raw.slice(raw.lastIndexOf(":") + 1);
    const match = /^(?:outline|ring)-(.+)$/.exec(base);
    if (!match) continue;
    const rest = match[1];
    if (!COLOR_TOKEN.test(rest)) continue;
    const scaleName = /^([a-z]+)-\d/.exec(rest)?.[1];
    if (scaleName === "opacity") continue;
    found = base;
  }
  return found;
}

// Same last-token-wins-across-both-prefixes shape as above, but for width:
// only an enumerated outline-{N}/ring-{N} or an arbitrary [Npx] sets a
// thickness. A color token (ring-blue-400), ring-offset-*, ring-inset, etc.
// don't match either shape and are silently ignored here -- they're a
// different utility's job (color, offset, inset), not this one's.
function lastIndicatorThicknessPx(focusClasses: string[]): number | null {
  let found: number | null = null;
  for (const raw of focusClasses) {
    const base = raw.slice(raw.lastIndexOf(":") + 1);
    const match = /^(?:outline|ring)-(.+)$/.exec(base);
    if (!match) continue;
    const token = match[1];
    if (token in WIDTH_SCALE) {
      found = WIDTH_SCALE[token];
      continue;
    }
    const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(token);
    if (arbitrary) found = Number(arbitrary[1]);
  }
  return found;
}

export function checkFocusContrast(
  checks: FocusIndicatorCheck[],
  strict = false,
  palette: Palette = defaultPalette
): FocusContrastViolation[] {
  const violations: FocusContrastViolation[] = [];

  for (const check of checks) {
    if (!check.bgClass) continue; // no resolvable background — skip, not a guess

    const indicatorBase = lastIndicatorColorToken(check.focusClasses);
    if (!indicatorBase) continue; // no explicit outline-*/ring-* color — out of scope, see CLAUDE.md

    const indicatorHex = resolveColorValue(indicatorBase, palette);
    const bgHex = resolveColorValue(check.bgClass, palette);
    if (!indicatorHex || !bgHex) continue; // custom theme color / unsupported arbitrary value — skip

    const indicatorRgb = hexToRgb(indicatorHex);
    const bgRgb = hexToRgb(bgHex);
    if (!indicatorRgb || !bgRgb) continue;

    const ratio = contrastRatio(indicatorRgb, bgRgb);
    const contrastFails = ratio < NON_TEXT_MIN_RATIO;

    let thicknessPx: number | null = null;
    if (strict) thicknessPx = lastIndicatorThicknessPx(check.focusClasses);
    const thicknessFails = strict && thicknessPx !== null && thicknessPx < FOCUS_INDICATOR_MIN_THICKNESS_PX;

    if (!contrastFails && !thicknessFails) continue;

    const rawIndicatorClass = check.focusClasses.find(
      (raw) => raw.slice(raw.lastIndexOf(":") + 1) === indicatorBase
    )!;

    violations.push({
      type: "focus-contrast",
      file: check.file,
      line: check.line,
      tagName: check.tagName,
      indicatorClass: rawIndicatorClass,
      bgClass: check.bgClass,
      ratio,
      required: NON_TEXT_MIN_RATIO,
      level: thicknessFails ? "AAA" : "AA",
      ...(thicknessFails && thicknessPx !== null
        ? { thicknessPx, requiredThicknessPx: FOCUS_INDICATOR_MIN_THICKNESS_PX }
        : {}),
    });
  }

  return violations;
}
