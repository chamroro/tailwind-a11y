import type {
  ContrastViolation,
  TouchTargetViolation,
  FocusIndicatorViolation,
  FocusContrastViolation,
  ReducedMotionViolation,
} from "tailwind-a11y";

export type AnyViolation =
  | ContrastViolation
  | TouchTargetViolation
  | FocusIndicatorViolation
  | FocusContrastViolation
  | ReducedMotionViolation;

// GitHub renders roughly 10 annotations per type per step (and ~50 per job) --
// undocumented, observed limits. Correctness never rides on annotations:
// every violation is also printed as a plain log line and counted toward the
// exit code regardless of how many annotations GitHub actually renders.
export const MAX_ANNOTATIONS = 10;

// Workflow-command escaping per the runner's own toCommandValue rules.
// Message data escapes %, \r, \n; property values (file=, title=) must
// additionally escape : and , since those delimit the property list.
export function escapeData(value: string): string {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

export function escapeProperty(value: string): string {
  return escapeData(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

// Same wording as cli.ts's formatViolation minus the leading "line:" prefix
// (the annotation itself carries file/line). Duplicated rather than exported
// from the engine, following the explicit format.ts precedent in the vscode
// adapter.
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

// `file` must be relative to the consumer repo root, forward slashes, no
// leading slash -- GitHub silently fails to attach the annotation otherwise.
export function toAnnotationCommand(v: AnyViolation): string {
  return `::error file=${escapeProperty(v.file)},line=${v.line},title=${escapeProperty("tailwind-a11y")}::${escapeData(formatViolation(v))}`;
}
