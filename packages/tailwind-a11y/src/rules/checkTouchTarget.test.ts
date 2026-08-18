import { describe, expect, it } from "vitest";
import { checkTouchTargets } from "./checkTouchTarget.js";
import { extractTouchTargetChecks } from "../parser/extractTouchTargets.js";

describe("checkTouchTargets", () => {
  it("flags a target smaller than 24x24", () => {
    const violations = checkTouchTargets([
      { file: "f.tsx", line: 1, tagName: "button", widthClass: "w-4", heightClass: "h-4", widthPx: 16, heightPx: 16 },
    ]);
    expect(violations).toEqual([
      {
        type: "touch-target",
        file: "f.tsx",
        line: 1,
        tagName: "button",
        widthClass: "w-4",
        heightClass: "h-4",
        widthPx: 16,
        heightPx: 16,
        required: 24,
        level: "AA",
      },
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

  it("prints the message users see in the CLI/ESLint output", () => {
    const [v] = checkTouchTargets([
      { file: "IconButton.tsx", line: 2, tagName: "button", widthClass: "w-4", heightClass: "h-4", widthPx: 16, heightPx: 16 },
    ]);
    // Same wording as cli.ts's formatViolation (touch-target case).
    console.log(
      `${v.line}: <${v.tagName}> is ${v.widthPx}×${v.heightPx}px (${v.widthClass} ${v.heightClass}) — WCAG ${v.level === "AAA" ? "2.5.5" : "2.5.8"} requires >= ${v.required}×${v.required}px`
    );
  });

  describe("strict mode (WCAG 2.5.5 AAA, 44x44)", () => {
    it("does not flag a 40x40 target by default (passes AA's 24px minimum)", () => {
      const violations = checkTouchTargets([
        { file: "f.tsx", line: 1, tagName: "button", widthClass: "w-10", heightClass: "h-10", widthPx: 40, heightPx: 40 },
      ]);
      expect(violations).toEqual([]);
    });

    it("flags the same 40x40 target under strict mode (fails AAA's 44px minimum)", () => {
      const violations = checkTouchTargets(
        [{ file: "f.tsx", line: 1, tagName: "button", widthClass: "w-10", heightClass: "h-10", widthPx: 40, heightPx: 40 }],
        true
      );
      expect(violations).toEqual([
        {
          type: "touch-target",
          file: "f.tsx",
          line: 1,
          tagName: "button",
          widthClass: "w-10",
          heightClass: "h-10",
          widthPx: 40,
          heightPx: 40,
          required: 44,
          level: "AAA",
        },
      ]);
    });

    it("passes exactly 44x44 under strict mode (minimum is inclusive, same as AA's 24px)", () => {
      const violations = checkTouchTargets(
        [{ file: "f.tsx", line: 1, tagName: "button", widthClass: "w-11", heightClass: "h-11", widthPx: 44, heightPx: 44 }],
        true
      );
      expect(violations).toEqual([]);
    });

    it("still flags a target below both thresholds under strict mode, reporting the strict values", () => {
      const violations = checkTouchTargets(
        [{ file: "f.tsx", line: 1, tagName: "button", widthClass: "w-4", heightClass: "h-4", widthPx: 16, heightPx: 16 }],
        true
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ required: 44, level: "AAA" });
    });
  });
});
