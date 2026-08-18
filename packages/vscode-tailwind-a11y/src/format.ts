import type { ContrastViolation, TouchTargetViolation, FocusIndicatorViolation } from "tailwind-a11y";

export type AnyViolation = ContrastViolation | TouchTargetViolation | FocusIndicatorViolation;

// Mirrors cli.ts's formatViolation, minus the leading "${line}: " prefix —
// VS Code renders the diagnostic's location itself. Kept in its own module
// (no 'vscode' import) so it's testable under vitest, which can't load the
// 'vscode' module outside the extension host.
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
  }
}
