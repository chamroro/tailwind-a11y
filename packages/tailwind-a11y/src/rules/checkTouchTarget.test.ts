import { describe, expect, it } from "vitest";
import { checkTouchTargets } from "./checkTouchTarget.js";
import { extractTouchTargetChecks } from "../parser/extractTouchTargets.js";

describe("checkTouchTargets", () => {
  it("flags a target smaller than 24x24", () => {
    const violations = checkTouchTargets([
      { file: "f.tsx", line: 1, tagName: "button", widthClass: "w-4", heightClass: "h-4", widthPx: 16, heightPx: 16 },
    ]);
    expect(violations).toEqual([
      { type: "touch-target", file: "f.tsx", line: 1, tagName: "button", widthClass: "w-4", heightClass: "h-4", widthPx: 16, heightPx: 16 },
    ]);
  });

  it("passes exactly 24x24 (minimum is inclusive)", () => {
    const violations = checkTouchTargets([
      { file: "f.tsx", line: 1, tagName: "button", widthClass: "w-6", heightClass: "h-6", widthPx: 24, heightPx: 24 },
    ]);
    expect(violations).toEqual([]);
  });

  it("flags when only one dimension is below the threshold", () => {
    const violations = checkTouchTargets([
      { file: "f.tsx", line: 1, tagName: "button", widthClass: "w-4", heightClass: "h-8", widthPx: 16, heightPx: 32 },
    ]);
    expect(violations).toHaveLength(1);
  });

  it("composes end-to-end with extractTouchTargetChecks", () => {
    const code = `const C = () => <button className="w-4 h-4">x</button>;`;
    const violations = checkTouchTargets(extractTouchTargetChecks(code, "fake.tsx"));
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("touch-target");
  });
});
