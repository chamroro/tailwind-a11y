import { describe, expect, it } from "vitest";
import { analyzeSource, formatViolation, wcagCriterion, type AnyViolation } from "./analyze.js";
import { defaultPalette } from "./theme/defaultPalette.js";
import { mergePalette } from "./theme/loadCustomTheme.js";
import { spacingScale } from "./theme/spacingScale.js";

// One source with something wrong for each of the five checks.
const ALL_FIVE = [
  "const C = () => (",
  "  <div>",
  '    <p className="text-gray-400 bg-white">contrast</p>',
  '    <button className="w-4 h-4">touch target</button>',
  '    <button className="focus:outline-none">focus removed</button>',
  '    <button className="bg-white focus:ring-2 focus:ring-gray-200">focus contrast</button>',
  '    <div className="transition-transform hover:scale-110">motion</div>',
  "  </div>",
  ");",
].join("\n");

const types = (violations: AnyViolation[]) => [...new Set(violations.map((v) => v.type))].sort();

describe("analyzeSource", () => {
  it("runs all five checks over one source under strict", () => {
    const result = analyzeSource(ALL_FIVE, "f.tsx", { strict: true });
    expect(result.parsed).toBe(true);
    expect(types(result.violations)).toEqual([
      "contrast",
      "focus-contrast",
      "focus-indicator",
      "reduced-motion",
      "touch-target",
    ]);
  });

  it("leaves the AAA-only reduced-motion check off unless strict", () => {
    const result = analyzeSource(ALL_FIVE, "f.tsx");
    expect(types(result.violations)).toEqual(["contrast", "focus-contrast", "focus-indicator", "touch-target"]);
  });

  // The API's core promise is "same checks, same arguments, same order as the
  // CLI". Each case below fails if exactly one argument is dropped or the
  // order changes -- found by deliberately mutating the implementation and
  // seeing the first version of this file pass anyway.
  describe("passes each option to the check that needs it", () => {
    it("runs the checks in the CLI's order", () => {
      const { violations } = analyzeSource(ALL_FIVE, "f.tsx", { strict: true });
      expect(violations.map((v) => v.type)).toEqual([
        "contrast",
        "touch-target",
        "focus-indicator",
        "focus-contrast",
        "reduced-motion",
      ]);
    });

    it("gives touch-target the strict flag: 40px passes AA but fails AAA", () => {
      const code = `const C = () => <button className="w-10 h-10">x</button>;`;
      expect(analyzeSource(code, "f.tsx").violations).toEqual([]);
      const [v] = analyzeSource(code, "f.tsx", { strict: true }).violations;
      expect(v).toMatchObject({ type: "touch-target", level: "AAA" });
    });

    it("gives focus-contrast the strict flag: a 1px ring only fails the AAA thickness rule", () => {
      const code = `const C = () => <button className="bg-white focus:ring-1 focus:ring-black">x</button>;`;
      expect(analyzeSource(code, "f.tsx").violations).toEqual([]);
      const [v] = analyzeSource(code, "f.tsx", { strict: true }).violations;
      expect(v).toMatchObject({ type: "focus-contrast", level: "AAA", thicknessPx: 1 });
    });

    it("gives focus-contrast the palette: a custom ring color is only checked once it resolves", () => {
      const code = `const C = () => <button className="bg-white focus:ring-2 focus:ring-brand-500">x</button>;`;
      const palette = mergePalette(defaultPalette, { brand: { "500": "#e5e7eb" } });
      expect(analyzeSource(code, "f.tsx").violations).toEqual([]);
      expect(types(analyzeSource(code, "f.tsx", { palette }).violations)).toEqual(["focus-contrast"]);
    });

    it("gives the contrast value-skips the palette: a custom color stops being reported once it resolves", () => {
      const code = `const C = () => <p className="text-brand-500 bg-white">x</p>;`;
      const withoutIt = analyzeSource(code, "f.tsx", { includeSkips: true });
      expect(withoutIt.skips.map((s) => s.reason)).toEqual([expect.stringContaining("text-brand-500 is not a recognized color")]);
      const palette = mergePalette(defaultPalette, { brand: { "500": "#111827" } });
      expect(analyzeSource(code, "f.tsx", { includeSkips: true, palette }).skips).toEqual([]);
    });

    it("gives the touch-target skips the spacing scale: a value missing from it is reported", () => {
      const code = `const C = () => <button className="w-11 h-4">x</button>;`;
      expect(analyzeSource(code, "f.tsx", { includeSkips: true }).skips).toEqual([]);
      const { skips } = analyzeSource(code, "f.tsx", { includeSkips: true, spacing: { "4": 16 } });
      expect(skips.map((s) => s.reason)).toEqual([expect.stringContaining("w-11 is not in the resolved spacing scale")]);
    });
  });

  it("reports violations against the file label it was given", () => {
    const [v] = analyzeSource(`const C = () => <p className="text-gray-400 bg-white">x</p>;`, "src/Card.tsx")
      .violations;
    expect(v.file).toBe("src/Card.tsx");
  });

  it("carries the fix suggestion on a contrast violation", () => {
    const [v] = analyzeSource(`const C = () => <p className="text-gray-400 bg-white">x</p>;`, "f.tsx").violations;
    expect(v).toMatchObject({ type: "contrast", suggestion: "text-gray-500" });
  });

  it("returns nothing for clean source", () => {
    const result = analyzeSource(`const C = () => <p className="text-gray-900 bg-white">ok</p>;`, "f.tsx", {
      includeSkips: true,
    });
    expect(result).toEqual({ parsed: true, violations: [], skips: [] });
  });

  describe("unparsable source", () => {
    it("is reported as parsed:false, not as a clean result", () => {
      const result = analyzeSource("const x = {{{ not valid jsx", "broken.tsx", { includeSkips: true });
      expect(result).toEqual({ parsed: false, violations: [], skips: [] });
    });

    it.each([
      ["an empty string", ""],
      ["a file with no JSX at all", "export const add = (a: number, b: number) => a + b;"],
    ])("treats %s as read (parsed:true) with nothing to report -- not as unreadable", (_label, code) => {
      expect(analyzeSource(code, "f.tsx", { includeSkips: true })).toEqual({ parsed: true, violations: [], skips: [] });
    });
  });

  describe("theme injection", () => {
    const code = `const C = () => <p className="text-brand-500 bg-white">x</p>;`;

    it("does not resolve a custom color without its palette", () => {
      expect(analyzeSource(code, "f.tsx").violations).toEqual([]);
    });

    it("checks it once the caller passes the resolved palette", () => {
      const palette = mergePalette(defaultPalette, { brand: { "500": "#9ca3af" } });
      const result = analyzeSource(code, "f.tsx", { palette });
      expect(types(result.violations)).toEqual(["contrast"]);
    });

    it("uses an injected spacing scale for touch targets", () => {
      const tiny = `const C = () => <button className="w-11 h-11">x</button>;`;
      expect(analyzeSource(tiny, "f.tsx").violations).toEqual([]);
      const result = analyzeSource(tiny, "f.tsx", { spacing: { ...spacingScale, "11": 10 } });
      expect(types(result.violations)).toEqual(["touch-target"]);
    });
  });

  describe("includeSkips", () => {
    const code = [
      "const C = () => (",
      "  <div>",
      '    <Card><p className="text-gray-400">no bg here</p></Card>',
      '    <button className="w-4">only a width</button>',
      '    <span className={cn("a")}>dynamic</span>',
      '    <p className="text-brand-500 bg-white">custom color</p>',
      "  </div>",
      ");",
    ].join("\n");

    it("reports nothing about skips by default", () => {
      expect(analyzeSource(code, "f.tsx").skips).toEqual([]);
    });

    it("merges every kind of skip, in line order", () => {
      const { skips } = analyzeSource(code, "f.tsx", { includeSkips: true });
      expect(skips.map((s) => s.line)).toEqual([3, 4, 5, 6]);
      expect(skips[0].reason).toContain("<Card>");
      expect(skips[1].reason).toContain("w-4");
      expect(skips[2].reason).toContain("cn(...) call");
      expect(skips[3].reason).toContain("text-brand-500");
    });

    it("exposes only line and reason", () => {
      const { skips } = analyzeSource(code, "f.tsx", { includeSkips: true });
      for (const s of skips) expect(Object.keys(s).sort()).toEqual(["line", "reason"]);
    });
  });
});

describe("wcagCriterion", () => {
  const cases: [string, AnyViolation, string][] = [
    ["contrast", { type: "contrast", file: "f", line: 1, textClass: "a", bgClass: "b", ratio: 1, required: 4.5, level: "AA" }, "1.4.3"],
    [
      "touch-target AA",
      { type: "touch-target", file: "f", line: 1, tagName: "button", widthClass: "w-4", heightClass: "h-4", widthPx: 16, heightPx: 16, required: 24, level: "AA" },
      "2.5.8",
    ],
    [
      "touch-target AAA",
      { type: "touch-target", file: "f", line: 1, tagName: "button", widthClass: "w-10", heightClass: "h-10", widthPx: 40, heightPx: 40, required: 44, level: "AAA" },
      "2.5.5",
    ],
    ["focus-indicator", { type: "focus-indicator", file: "f", line: 1, tagName: "button", removalClass: "outline-none" }, "2.4.7"],
    [
      "focus-contrast AA",
      { type: "focus-contrast", file: "f", line: 1, tagName: "button", indicatorClass: "ring-a", bgClass: "bg-b", ratio: 1, required: 3, level: "AA" },
      "1.4.11",
    ],
    [
      "focus-contrast AAA",
      { type: "focus-contrast", file: "f", line: 1, tagName: "button", indicatorClass: "ring-a", bgClass: "bg-b", ratio: 1, required: 3, level: "AAA" },
      "2.4.13",
    ],
    [
      "reduced-motion",
      { type: "reduced-motion", mechanism: "animate", file: "f", line: 1, tagName: "div", motionClass: "hover:animate-bounce", level: "AAA" },
      "2.3.3",
    ],
  ];

  it.each(cases)("%s -> %s", (_label, violation, expected) => {
    expect(wcagCriterion(violation)).toBe(expected);
  });
});

// The strings below are copied from the VS Code adapter's format.test.ts: the
// engine's formatViolation must stay word-for-word identical to it until the
// adapters are moved onto this one.
describe("formatViolation", () => {
  it("formats a contrast violation without a suggestion", () => {
    expect(
      formatViolation({ type: "contrast", file: "f.tsx", line: 3, textClass: "text-white", bgClass: "bg-gray-300", ratio: 1.47, required: 4.5, level: "AA" })
    ).toBe("text-white on bg-gray-300 — ratio 1.47, needs 4.5 (AA)");
  });

  it("formats a contrast violation with a suggestion", () => {
    expect(
      formatViolation({
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
      })
    ).toBe("text-gray-400 on bg-white — ratio 2.54, needs 4.5 (AA); try text-gray-500 (4.83)");
  });

  it("formats a touch-target violation", () => {
    expect(
      formatViolation({ type: "touch-target", file: "f.tsx", line: 2, tagName: "button", widthClass: "w-4", heightClass: "h-4", widthPx: 16, heightPx: 16, required: 24, level: "AA" })
    ).toBe("<button> is 16×16px (w-4 h-4) — WCAG 2.5.8 requires >= 24×24px");
  });

  it("formats a strict-mode touch-target violation with WCAG 2.5.5 and the 44px threshold", () => {
    expect(
      formatViolation({ type: "touch-target", file: "f.tsx", line: 2, tagName: "button", widthClass: "w-10", heightClass: "h-10", widthPx: 40, heightPx: 40, required: 44, level: "AAA" })
    ).toBe("<button> is 40×40px (w-10 h-10) — WCAG 2.5.5 requires >= 44×44px");
  });

  it("formats a focus-indicator violation", () => {
    expect(
      formatViolation({ type: "focus-indicator", file: "f.tsx", line: 6, tagName: "button", removalClass: "focus:outline-none" })
    ).toBe(
      "<button> removes the focus outline (focus:outline-none) with no visible replacement (focus:ring-*/border-*/shadow-*/bg-*/outline-*)"
    );
  });

  it("formats a focus-contrast violation (contrast only, AA)", () => {
    expect(
      formatViolation({ type: "focus-contrast", file: "f.tsx", line: 1, tagName: "button", indicatorClass: "focus:ring-blue-400", bgClass: "bg-blue-500", ratio: 1.45, required: 3, level: "AA" })
    ).toBe("<button> focus indicator focus:ring-blue-400 on bg-blue-500 — ratio 1.45, needs 3 (WCAG 1.4.11)");
  });

  it("formats a strict-mode focus-contrast violation with a thickness failure (AAA)", () => {
    expect(
      formatViolation({
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
      })
    ).toBe(
      "<button> focus indicator focus:ring-white on bg-blue-500 — ratio 3.68, needs 3 (WCAG 2.4.13); also only 1px thick, needs >= 2px"
    );
  });

  it("formats a reduced-motion violation (transition mechanism)", () => {
    expect(
      formatViolation({
        type: "reduced-motion",
        mechanism: "transition",
        file: "f.tsx",
        line: 1,
        tagName: "div",
        transitionClass: "transition-transform",
        motionClass: "hover:scale-110",
        level: "AAA",
      })
    ).toBe(
      "<div> animates hover:scale-110 via transition-transform with no motion-reduce:transition-none/transform-none guard — WCAG 2.3.3 requires motion animation triggered by interaction to be disableable"
    );
  });

  it("formats a reduced-motion violation (animate mechanism)", () => {
    expect(
      formatViolation({ type: "reduced-motion", mechanism: "animate", file: "f.tsx", line: 1, tagName: "div", motionClass: "hover:animate-bounce", level: "AAA" })
    ).toBe(
      "<div> animates hover:animate-bounce via a CSS animation with no motion-reduce:animate-none guard — WCAG 2.3.3 requires motion animation triggered by interaction to be disableable"
    );
  });
});
