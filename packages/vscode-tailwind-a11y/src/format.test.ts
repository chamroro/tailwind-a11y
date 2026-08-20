import { describe, expect, it } from "vitest";
import { formatViolation } from "./format.js";

describe("formatViolation", () => {
  it("formats a contrast violation without a suggestion", () => {
    const message = formatViolation({
      type: "contrast",
      file: "f.tsx",
      line: 3,
      textClass: "text-white",
      bgClass: "bg-gray-300",
      ratio: 1.47,
      required: 4.5,
      level: "AA",
    });
    expect(message).toBe("text-white on bg-gray-300 — ratio 1.47, needs 4.5 (AA)");
  });

  it("formats a contrast violation with a suggestion", () => {
    const message = formatViolation({
      type: "contrast",
      file: "f.tsx",
      line: 3,
      textClass: "text-gray-400",
      bgClass: "bg-white",
      ratio: 2.54,
      required: 4.5,
      level: "AA",
      suggestion: "text-gray-500",
      suggestedRatio: 4.83,
    });
    expect(message).toBe("text-gray-400 on bg-white — ratio 2.54, needs 4.5 (AA); try text-gray-500 (4.83)");
  });

  it("formats a touch-target violation", () => {
    const message = formatViolation({
      type: "touch-target",
      file: "f.tsx",
      line: 2,
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
      file: "f.tsx",
      line: 2,
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
      file: "f.tsx",
      line: 6,
      tagName: "button",
      removalClass: "focus:outline-none",
    });
    expect(message).toBe(
      "<button> removes the focus outline (focus:outline-none) with no visible replacement (focus:ring-*/border-*/shadow-*/bg-*/outline-*)"
    );
  });

  it("formats a focus-contrast violation (contrast only, AA)", () => {
    const message = formatViolation({
      type: "focus-contrast",
      file: "f.tsx",
      line: 1,
      tagName: "button",
      indicatorClass: "focus:ring-blue-400",
      bgClass: "bg-blue-500",
      ratio: 1.45,
      required: 3,
      level: "AA",
    });
    expect(message).toBe("<button> focus indicator focus:ring-blue-400 on bg-blue-500 — ratio 1.45, needs 3 (WCAG 1.4.11)");
  });

  it("formats a strict-mode focus-contrast violation with a thickness failure (AAA)", () => {
    const message = formatViolation({
      type: "focus-contrast",
      file: "f.tsx",
      line: 1,
      tagName: "button",
      indicatorClass: "focus:ring-white",
      bgClass: "bg-blue-500",
      ratio: 3.68,
      required: 3,
      level: "AAA",
      thicknessPx: 1,
      requiredThicknessPx: 2,
    });
    expect(message).toBe(
      "<button> focus indicator focus:ring-white on bg-blue-500 — ratio 3.68, needs 3 (WCAG 2.4.13); also only 1px thick, needs >= 2px"
    );
  });
});
