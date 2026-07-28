import { describe, expect, it } from "vitest";
import { checkContrast, checkContrastValueSkips, suggestContrastFix } from "./checkContrast.js";
import { extractChecks } from "../parser/extractClasses.js";

describe("checkContrast", () => {
  it("flags a known low-contrast pair", () => {
    const violations = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-400", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ level: "AA", required: 4.5 });
    expect(violations[0].ratio).toBeLessThan(4.5);
  });

  it("prints the message users see in the CLI/ESLint output", () => {
    const [v] = checkContrast([
      { file: "Card.tsx", line: 3, textColorClass: "text-gray-400", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    // Same wording as cli.ts's formatViolation (contrast case) and
    // eslint-plugin-tailwind-a11y's contrast rule message template.
    const base = `${v.line}: ${v.textClass} on ${v.bgClass} — ratio ${v.ratio.toFixed(2)}, needs ${v.required} (${v.level})`;
    console.log(v.suggestion ? `${base}; try ${v.suggestion} (${v.suggestedRatio!.toFixed(2)})` : base);
  });

  it("carries a suggestion on the violation when one is available", () => {
    const [v] = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-400", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(v).toMatchObject({ suggestion: "text-gray-500" });
    expect(v.suggestedRatio).toBeGreaterThanOrEqual(4.5);
  });

  it("omits both suggestion fields entirely when no suggestion is available", () => {
    const [v] = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-white", bgColorClass: "bg-gray-300", bgSource: "self" },
    ]);
    expect("suggestion" in v).toBe(false);
    expect("suggestedRatio" in v).toBe(false);
  });

  it("passes a known compliant pair", () => {
    const violations = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-900", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(violations).toEqual([]);
  });

  it("resolves arbitrary hex values", () => {
    const violations = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-[#eeeeee]", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(violations).toHaveLength(1);
  });

  it("silently skips unknown/custom colors not in the default palette", () => {
    const violations = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-brand-500", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(violations).toEqual([]);
  });

  it("silently skips non-hex arbitrary values", () => {
    const violations = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-[var(--fg)]", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(violations).toEqual([]);
  });

  it("silently skips opacity-modifier shorthand", () => {
    const violations = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-400", bgColorClass: "bg-white/50", bgSource: "self" },
    ]);
    expect(violations).toEqual([]);
  });

  it("composes end-to-end with extractChecks on the CLAUDE.md canonical example", () => {
    const code = `
      const C = () => (
        <div className="bg-white">
          <p className="text-gray-400">low contrast, but not on the same element</p>
        </div>
      );
    `;
    const violations = checkContrast(extractChecks(code, "fake.tsx"));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ textClass: "text-gray-400", bgClass: "bg-white" });
  });
});

describe("checkContrastValueSkips", () => {
  it("reports a skip for an unrecognized custom color", () => {
    const skips = checkContrastValueSkips([
      { file: "f.tsx", line: 1, textColorClass: "text-brand-500", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(skips).toHaveLength(1);
    expect(skips[0].reason).toContain("text-brand-500");
  });

  it("reports a skip for opacity-modifier shorthand", () => {
    const skips = checkContrastValueSkips([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-400", bgColorClass: "bg-white/50", bgSource: "self" },
    ]);
    expect(skips).toHaveLength(1);
    expect(skips[0].reason).toContain("bg-white/50");
  });

  it("does not report a skip for a fully resolvable pair", () => {
    const skips = checkContrastValueSkips([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-400", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(skips).toEqual([]);
  });
});

describe("suggestContrastFix", () => {
  it("finds a nearby passing shade", () => {
    const fix = suggestContrastFix("text-gray-400", "bg-white", 4.5);
    expect(fix?.textClass).toBe("text-gray-500");
    expect(fix?.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("ties go to the higher/darker shade (400 -> 500, not 300)", () => {
    // gray-300 and gray-500 are both distance 100 from gray-400.
    const fix = suggestContrastFix("text-gray-400", "bg-white", 4.5);
    expect(fix?.textClass).toBe("text-gray-500");
    expect(fix?.textClass).not.toBe("text-gray-300");
  });

  it("returns null for semantic text colors", () => {
    expect(suggestContrastFix("text-white", "bg-gray-300", 4.5)).toBeNull();
  });

  it("returns null for arbitrary hex text colors", () => {
    expect(suggestContrastFix("text-[#eeeeee]", "bg-white", 4.5)).toBeNull();
  });

  it("returns null for an unknown/custom scale", () => {
    expect(suggestContrastFix("text-brand-500", "bg-white", 4.5)).toBeNull();
  });

  it("returns null for opacity-modifier shorthand on the text class", () => {
    expect(suggestContrastFix("text-gray-400/50", "bg-white", 4.5)).toBeNull();
  });

  it("returns null for the opacity decoy token (same shape as a color, isn't one)", () => {
    expect(suggestContrastFix("text-opacity-50", "bg-white", 4.5)).toBeNull();
  });

  it("returns null when the background is unresolvable", () => {
    expect(suggestContrastFix("text-gray-400", "bg-brand-50", 4.5)).toBeNull();
  });

  it("returns null when no shade in the scale would pass", () => {
    expect(suggestContrastFix("text-red-400", "bg-red-500", 4.5)).toBeNull();
  });

  it("searches in both directions (dark background needs a lighter shade)", () => {
    const fix = suggestContrastFix("text-gray-600", "bg-gray-900", 4.5);
    expect(fix?.textClass).toBe("text-gray-400");
    expect(fix?.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("never returns the original shade", () => {
    const fix = suggestContrastFix("text-gray-400", "bg-white", 4.5);
    expect(fix).not.toBeNull();
    expect(fix?.textClass).not.toBe("text-gray-400");
    expect(fix?.ratio).toBeGreaterThanOrEqual(4.5);
  });
});
