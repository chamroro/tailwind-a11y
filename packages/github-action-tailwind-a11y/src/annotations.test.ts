import { describe, expect, it } from "vitest";
import { escapeData, escapeProperty, formatViolation, toAnnotationCommand } from "./annotations.js";

describe("escapeData / escapeProperty", () => {
  it("escapes %, CR, LF in data", () => {
    expect(escapeData("100% done\r\nnext")).toBe("100%25 done%0D%0Anext");
  });

  it("escapes % before the others so the escape sequences themselves survive", () => {
    expect(escapeData("%0A")).toBe("%250A");
  });

  it("property values additionally escape : and ,", () => {
    expect(escapeProperty("a:b,c")).toBe("a%3Ab%2Cc");
  });
});

describe("formatViolation", () => {
  it("formats a contrast violation with a suggestion", () => {
    const message = formatViolation({
      type: "contrast",
      file: "src/App.tsx",
      line: 3,
      textClass: "text-gray-400",
      bgClass: "bg-white",
      ratio: 2.538,
      required: 4.5,
      level: "AA",
      suggestion: "text-gray-500",
      suggestedRatio: 4.834,
    });
    expect(message).toBe("text-gray-400 on bg-white — ratio 2.54, needs 4.5 (AA); try text-gray-500 (4.83)");
  });

  it("formats a touch-target violation", () => {
    const message = formatViolation({
      type: "touch-target",
      file: "src/IconButton.tsx",
      line: 5,
      tagName: "button",
      widthClass: "w-4",
      heightClass: "h-4",
      widthPx: 16,
      heightPx: 16,
      required: 24,
      level: "AA",
    });
    expect(message).toBe("<button> is 16×16px (w-4 h-4) — WCAG 2.5.8 requires >= 24×24px");
  });

  it("formats a strict-mode touch-target violation with WCAG 2.5.5 and the 44px threshold", () => {
    const message = formatViolation({
      type: "touch-target",
      file: "src/IconButton.tsx",
      line: 5,
      tagName: "button",
      widthClass: "w-10",
      heightClass: "h-10",
      widthPx: 40,
      heightPx: 40,
      required: 44,
      level: "AAA",
    });
    expect(message).toBe("<button> is 40×40px (w-10 h-10) — WCAG 2.5.5 requires >= 44×44px");
  });

  it("formats a focus-indicator violation", () => {
    const message = formatViolation({
      type: "focus-indicator",
      file: "src/Link.tsx",
      line: 8,
      tagName: "a",
      removalClass: "focus:outline-none",
    });
    expect(message).toBe(
      "<a> removes the focus outline (focus:outline-none) with no visible replacement (focus:ring-*/border-*/shadow-*/bg-*/outline-*)"
    );
  });

  it("formats a focus-contrast violation (contrast only, AA)", () => {
    const message = formatViolation({
      type: "focus-contrast",
      file: "src/Link.tsx",
      line: 8,
      tagName: "a",
      indicatorClass: "focus:ring-blue-400",
      bgClass: "bg-blue-500",
      ratio: 1.45,
      required: 3,
      level: "AA",
    });
    expect(message).toBe("<a> focus indicator focus:ring-blue-400 on bg-blue-500 — ratio 1.45, needs 3 (WCAG 1.4.11)");
  });

  it("formats a strict-mode focus-contrast violation with a thickness failure (AAA)", () => {
    const message = formatViolation({
      type: "focus-contrast",
      file: "src/Link.tsx",
      line: 8,
      tagName: "a",
      indicatorClass: "focus:ring-white",
      bgClass: "bg-blue-500",
      ratio: 3.68,
      required: 3,
      level: "AAA",
      thicknessPx: 1,
      requiredThicknessPx: 2,
    });
    expect(message).toBe(
      "<a> focus indicator focus:ring-white on bg-blue-500 — ratio 3.68, needs 3 (WCAG 2.4.13); also only 1px thick, needs >= 2px"
    );
  });

  it("formats a reduced-motion violation (transition mechanism)", () => {
    const message = formatViolation({
      type: "reduced-motion",
      mechanism: "transition",
      file: "src/Card.tsx",
      line: 3,
      tagName: "div",
      transitionClass: "transition-transform",
      motionClass: "hover:scale-110",
      level: "AAA",
    });
    expect(message).toBe(
      "<div> animates hover:scale-110 via transition-transform with no motion-reduce:transition-none/transform-none guard — WCAG 2.3.3 requires motion animation triggered by interaction to be disableable"
    );
  });

  it("formats a reduced-motion violation (animate mechanism)", () => {
    const message = formatViolation({
      type: "reduced-motion",
      mechanism: "animate",
      file: "src/Card.tsx",
      line: 3,
      tagName: "div",
      motionClass: "hover:animate-bounce",
      level: "AAA",
    });
    expect(message).toBe(
      "<div> animates hover:animate-bounce via a CSS animation with no motion-reduce:animate-none guard — WCAG 2.3.3 requires motion animation triggered by interaction to be disableable"
    );
  });
});

describe("toAnnotationCommand", () => {
  it("builds a complete ::error command with repo-relative file and line", () => {
    const command = toAnnotationCommand({
      type: "touch-target",
      file: "src/IconButton.tsx",
      line: 5,
      tagName: "button",
      widthClass: "w-4",
      heightClass: "h-4",
      widthPx: 16,
      heightPx: 16,
      required: 24,
      level: "AA",
    });
    expect(command).toBe(
      "::error file=src/IconButton.tsx,line=5,title=tailwind-a11y::<button> is 16×16px (w-4 h-4) — WCAG 2.5.8 requires >= 24×24px"
    );
  });

  it("escapes a comma-bearing file path in the property position", () => {
    const command = toAnnotationCommand({
      type: "focus-indicator",
      file: "src/a,b.tsx",
      line: 1,
      tagName: "a",
      removalClass: "focus:outline-none",
    });
    expect(command).toContain("file=src/a%2Cb.tsx,");
  });
});
