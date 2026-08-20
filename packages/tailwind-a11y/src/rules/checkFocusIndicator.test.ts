import { describe, expect, it } from "vitest";
import { checkFocusContrast, checkFocusIndicators } from "./checkFocusIndicator.js";
import { extractFocusIndicatorChecks } from "../parser/extractFocusIndicators.js";
import { defaultPalette } from "../theme/defaultPalette.js";
import { mergePalette } from "../theme/loadCustomTheme.js";

describe("checkFocusIndicators", () => {
  it("flags a bare focus:outline-none with nothing else", () => {
    const violations = checkFocusIndicators([
      { file: "f.tsx", line: 1, tagName: "button", focusClasses: ["focus:outline-none"] },
    ]);
    expect(violations).toEqual([
      { type: "focus-indicator", file: "f.tsx", line: 1, tagName: "button", removalClass: "focus:outline-none" },
    ]);
  });

  it("prints the message users see in the CLI/ESLint output", () => {
    const [v] = checkFocusIndicators([
      { file: "SaveButton.tsx", line: 6, tagName: "button", focusClasses: ["focus:outline-none"] },
    ]);
    // Same wording as cli.ts's formatViolation (focus-indicator case).
    console.log(
      `${v.line}: <${v.tagName}> removes the focus outline (${v.removalClass}) with no visible replacement (focus:ring-*/border-*/shadow-*/bg-*/outline-*)`
    );
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

  it.each([
    "focus:bg-fixed",
    "focus:bg-local",
    "focus:bg-scroll",
    "focus:bg-repeat",
    "focus:bg-no-repeat",
    "focus:bg-repeat-x",
    "focus:bg-repeat-y",
    "focus:bg-repeat-round",
    "focus:bg-repeat-space",
    "focus:bg-auto",
    "focus:bg-cover",
    "focus:bg-contain",
    "focus:bg-clip-border",
    "focus:bg-clip-padding",
    "focus:bg-clip-content",
    "focus:bg-clip-text",
    "focus:bg-origin-border",
    "focus:bg-origin-padding",
    "focus:bg-origin-content",
    "focus:bg-none",
    "focus:bg-bottom",
    "focus:bg-center",
    "focus:bg-left",
    "focus:bg-left-bottom",
    "focus:bg-left-top",
    "focus:bg-right",
    "focus:bg-right-bottom",
    "focus:bg-right-top",
    "focus:bg-top",
    "focus:border-collapse",
    "focus:border-separate",
    "focus:bg-blend-multiply",
  ])("still flags when the only 'replacement' is a non-visual decoy %s (regression)", (decoy) => {
    const violations = checkFocusIndicators([
      { file: "f.tsx", line: 1, tagName: "button", focusClasses: ["focus:outline-none", decoy] },
    ]);
    expect(violations).toHaveLength(1);
  });

  it.each([
    "focus:border-none",
    "focus:border-hidden",
    "focus:border-spacing-8",
    "focus:border-spacing-x-4",
    "focus:border-spacing-y-2",
  ])("still flags when the only 'replacement' is a table/border-style decoy %s (regression)", (decoy) => {
    const violations = checkFocusIndicators([
      { file: "f.tsx", line: 1, tagName: "button", focusClasses: ["focus:outline-none", decoy] },
    ]);
    expect(violations).toHaveLength(1);
  });

  it.each([
    "focus:shadow-red-500",
    "focus:shadow-black",
    "focus:shadow-[#fff]",
    "focus:ring-red-500",
    "focus:ring-blue-400/50",
  ])("still flags when the only 'replacement' is a color-only shadow/ring decoy %s (regression)", (decoy) => {
    const violations = checkFocusIndicators([
      { file: "f.tsx", line: 1, tagName: "button", focusClasses: ["focus:outline-none", decoy] },
    ]);
    expect(violations).toHaveLength(1);
  });

  it("still passes when a shadow/ring color is paired with a real size utility", () => {
    const violations = checkFocusIndicators([
      { file: "f.tsx", line: 1, tagName: "button", focusClasses: ["focus:outline-none", "focus:shadow-lg", "focus:shadow-red-500"] },
    ]);
    expect(violations).toEqual([]);
  });

  it.each([
    "focus:outline-dashed",
    "focus:outline-dotted",
    "focus:outline-solid",
    "focus:outline-double",
  ])("passes for %s alone (confirmed real: browser default outline-width is not reset by preflight)", (real) => {
    const violations = checkFocusIndicators([
      { file: "f.tsx", line: 1, tagName: "button", focusClasses: ["focus:outline-none", real] },
    ]);
    expect(violations).toEqual([]);
  });

  it("passes for a border-width-only utility alone (confirmed real: border-color defaults to currentColor)", () => {
    const violations = checkFocusIndicators([
      { file: "f.tsx", line: 1, tagName: "button", focusClasses: ["focus:outline-none", "focus:border-t-4"] },
    ]);
    expect(violations).toEqual([]);
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

describe("checkFocusContrast", () => {
  it("flags a low-contrast ring (blue-400 on blue-500, ~1.3:1) — the case checkFocusIndicators misses entirely", () => {
    const violations = checkFocusContrast([
      {
        file: "f.tsx",
        line: 1,
        tagName: "button",
        focusClasses: ["focus:outline-none", "focus:ring-2", "focus:ring-blue-400"],
        bgClass: "bg-blue-500",
        bgSource: "self",
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      type: "focus-contrast",
      indicatorClass: "focus:ring-blue-400",
      bgClass: "bg-blue-500",
      required: 3,
      level: "AA",
    });
    expect(violations[0].ratio).toBeLessThan(3);
    expect(violations[0].thicknessPx).toBeUndefined();
  });

  it("passes a high-contrast ring (white on blue-500) by default", () => {
    const violations = checkFocusContrast([
      {
        file: "f.tsx",
        line: 1,
        tagName: "button",
        focusClasses: ["focus:outline-none", "focus:ring-2", "focus:ring-white"],
        bgClass: "bg-blue-500",
        bgSource: "self",
      },
    ]);
    expect(violations).toEqual([]);
  });

  it("passes a high-contrast ring-2 under strict too (contrast and thickness both meet AAA)", () => {
    const violations = checkFocusContrast(
      [
        {
          file: "f.tsx",
          line: 1,
          tagName: "button",
          focusClasses: ["focus:outline-none", "focus:ring-2", "focus:ring-white"],
          bgClass: "bg-blue-500",
          bgSource: "self",
        },
      ],
      true
    );
    expect(violations).toEqual([]);
  });

  it("flags ring-1 under strict even though contrast passes — thickness is an independent requirement, not a stricter ratio", () => {
    const violations = checkFocusContrast(
      [
        {
          file: "f.tsx",
          line: 1,
          tagName: "button",
          focusClasses: ["focus:outline-none", "focus:ring-1", "focus:ring-white"],
          bgClass: "bg-blue-500",
          bgSource: "self",
        },
      ],
      true
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].ratio).toBeGreaterThanOrEqual(3); // contrast genuinely passes
    expect(violations[0]).toMatchObject({
      level: "AAA",
      thicknessPx: 1,
      requiredThicknessPx: 2,
    });
  });

  it("does not flag ring-1 the same case by default (thickness is only assessed under strict)", () => {
    const violations = checkFocusContrast([
      {
        file: "f.tsx",
        line: 1,
        tagName: "button",
        focusClasses: ["focus:outline-none", "focus:ring-1", "focus:ring-white"],
        bgClass: "bg-blue-500",
        bgSource: "self",
      },
    ]);
    expect(violations).toEqual([]);
  });

  it("resolves contrast for a bare `ring` (no width digit) under strict, but never fabricates a thickness value", () => {
    const violations = checkFocusContrast(
      [
        {
          file: "f.tsx",
          line: 1,
          tagName: "button",
          focusClasses: ["focus:outline-none", "focus:ring", "focus:ring-blue-400"],
          bgClass: "bg-blue-500",
          bgSource: "self",
        },
      ],
      true
    );
    // contrast still fails (blue-400 on blue-500) and is reported; thickness
    // is unresolvable for a bare `ring` (version-dependent, see
    // checkFocusIndicator.ts) so it's simply absent, never asserted.
    expect(violations).toHaveLength(1);
    expect(violations[0].level).toBe("AA");
    expect(violations[0].thicknessPx).toBeUndefined();
    expect(violations[0].requiredThicknessPx).toBeUndefined();
  });

  it("skips when there's no resolvable background", () => {
    const violations = checkFocusContrast([
      {
        file: "f.tsx",
        line: 1,
        tagName: "button",
        focusClasses: ["focus:outline-none", "focus:ring-2", "focus:ring-blue-400"],
        bgClass: null,
        bgSource: null,
      },
    ]);
    expect(violations).toEqual([]);
  });

  it("skips when there's no explicit outline-*/ring-* color (out of scope, not a false pass)", () => {
    const violations = checkFocusContrast([
      {
        file: "f.tsx",
        line: 1,
        tagName: "button",
        focusClasses: ["focus:outline-none", "focus:border-4", "focus:border-blue-400"],
        bgClass: "bg-blue-500",
        bgSource: "self",
      },
    ]);
    expect(violations).toEqual([]);
  });

  it("does not mistake ring-offset-* for the ring's own color or width", () => {
    const violations = checkFocusContrast(
      [
        {
          file: "f.tsx",
          line: 1,
          tagName: "button",
          focusClasses: [
            "focus:outline-none",
            "focus:ring-2",
            "focus:ring-white",
            "focus:ring-offset-2",
            "focus:ring-offset-blue-400",
          ],
          bgClass: "bg-blue-500",
          bgSource: "self",
        },
      ],
      true
    );
    // ring-white/ring-2 (the real indicator) is well above 3:1 and exactly
    // 2px -- passes. If ring-offset-blue-400 or ring-offset-2 were
    // mistakenly read as the indicator's own color/width, this would either
    // false-flag or resolve the wrong values.
    expect(violations).toEqual([]);
  });

  it("last-token-wins across outline-* and ring-* together, not per-prefix", () => {
    const violations = checkFocusContrast([
      {
        file: "f.tsx",
        line: 1,
        tagName: "button",
        // outline-blue-400 (low contrast) written first, ring-white (high
        // contrast) written after -- the later one in source order is what
        // actually renders, so it should win over the ignored one.
        focusClasses: ["focus:outline-none", "focus:outline-blue-400", "focus:ring-2", "focus:ring-white"],
        bgClass: "bg-blue-500",
        bgSource: "self",
      },
    ]);
    expect(violations).toEqual([]);
  });

  it("composes end-to-end with extractFocusIndicatorChecks", () => {
    const code = `const C = () => <button className="bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400">x</button>;`;
    const violations = checkFocusContrast(extractFocusIndicatorChecks(code, "fake.tsx"));
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("focus-contrast");
  });

  describe("with a custom palette", () => {
    // Same hex as the stock blue-400 (#60a5fa), so an invisible custom-
    // themed ring must be caught the same way the stock blue-400 case is
    // above -- a default-palette-only call would silently see "brand-400"
    // as unresolvable and report nothing (a real gap this project's
    // checkContrast/checkTouchTargets siblings already close via their own
    // palette param).
    const customPalette = mergePalette(defaultPalette, { brand: { "400": "#60a5fa" } });

    it("resolves a custom-theme indicator color that a default-palette-only call would skip entirely", () => {
      const noPalette = checkFocusContrast([
        {
          file: "f.tsx",
          line: 1,
          tagName: "button",
          focusClasses: ["focus:outline-none", "focus:ring-2", "focus:ring-brand-400"],
          bgClass: "bg-blue-500",
          bgSource: "self",
        },
      ]);
      expect(noPalette).toEqual([]); // unresolvable without the custom palette -- silent skip, not a false pass

      const withPalette = checkFocusContrast(
        [
          {
            file: "f.tsx",
            line: 1,
            tagName: "button",
            focusClasses: ["focus:outline-none", "focus:ring-2", "focus:ring-brand-400"],
            bgClass: "bg-blue-500",
            bgSource: "self",
          },
        ],
        false,
        customPalette
      );
      expect(withPalette).toHaveLength(1);
      expect(withPalette[0].ratio).toBeLessThan(3);
    });

    it("resolves a custom-theme background the same way", () => {
      const customBgPalette = mergePalette(defaultPalette, { brand: { "500": "#1e3a8a" } }); // dark navy
      const violations = checkFocusContrast(
        [
          {
            file: "f.tsx",
            line: 1,
            tagName: "button",
            focusClasses: ["focus:outline-none", "focus:ring-2", "focus:ring-blue-400"],
            bgClass: "bg-brand-500",
            bgSource: "self",
          },
        ],
        false,
        customBgPalette
      );
      // blue-400 on a dark navy custom background is a real pass -- would be
      // wrongly skipped (bg unresolvable) without the custom palette.
      expect(violations).toEqual([]);
    });
  });
});
