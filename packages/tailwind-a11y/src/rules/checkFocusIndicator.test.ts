import { describe, expect, it } from "vitest";
import { checkFocusIndicators } from "./checkFocusIndicator.js";
import { extractFocusIndicatorChecks } from "../parser/extractFocusIndicators.js";

describe("checkFocusIndicators", () => {
  it("flags a bare focus:outline-none with nothing else", () => {
    const violations = checkFocusIndicators([
      { file: "f.tsx", line: 1, tagName: "button", focusClasses: ["focus:outline-none"] },
    ]);
    expect(violations).toEqual([
      { type: "focus-indicator", file: "f.tsx", line: 1, tagName: "button", removalClass: "focus:outline-none" },
    ]);
  });

  it("passes when a real replacement ring is present", () => {
    const violations = checkFocusIndicators([
      { file: "f.tsx", line: 1, tagName: "button", focusClasses: ["focus:outline-none", "focus:ring-2"] },
    ]);
    expect(violations).toEqual([]);
  });

  it("passes the cross-variant real-world pattern (focus:outline-none + focus-visible:ring-2)", () => {
    const violations = checkFocusIndicators([
      { file: "f.tsx", line: 1, tagName: "button", focusClasses: ["focus:outline-none", "focus-visible:ring-2"] },
    ]);
    expect(violations).toEqual([]);
  });

  it("does not consider elements with no removal class a violation", () => {
    const violations = checkFocusIndicators([
      { file: "f.tsx", line: 1, tagName: "button", focusClasses: ["focus:ring-2"] },
    ]);
    expect(violations).toEqual([]);
  });

  it.each([
    "focus:ring-0",
    "focus:border-0",
    "focus:shadow-none",
    "focus:bg-transparent",
  ])("still flags when the only 'replacement' is the degenerate decoy %s (regression)", (decoy) => {
    const violations = checkFocusIndicators([
      { file: "f.tsx", line: 1, tagName: "button", focusClasses: ["focus:outline-none", decoy] },
    ]);
    expect(violations).toHaveLength(1);
  });

  it.each([
    "focus:bg-opacity-50",
    "focus:border-opacity-50",
    "focus:ring-opacity-50",
    "focus:ring-offset-2",
    "focus:outline-offset-2",
    "focus:ring-inset",
  ])("still flags when the only 'replacement' is a modifier-only decoy %s (regression)", (decoy) => {
    const violations = checkFocusIndicators([
      { file: "f.tsx", line: 1, tagName: "button", focusClasses: ["focus:outline-none", decoy] },
    ]);
    expect(violations).toHaveLength(1);
  });

  it("still passes when a modifier accompanies a real replacement value", () => {
    const violations = checkFocusIndicators([
      {
        file: "f.tsx",
        line: 1,
        tagName: "button",
        focusClasses: ["focus:outline-none", "focus:ring-2", "focus:ring-offset-2"],
      },
    ]);
    expect(violations).toEqual([]);
  });

  it("composes end-to-end with extractFocusIndicatorChecks", () => {
    const code = `const C = () => <button className="focus:outline-none">x</button>;`;
    const violations = checkFocusIndicators(extractFocusIndicatorChecks(code, "fake.tsx"));
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("focus-indicator");
  });
});
