import { describe, expect, it } from "vitest";
import { checkContrast, checkContrastValueSkips, suggestContrastFix } from "./checkContrast.js";
import { extractChecks } from "../parser/extractClasses.js";
import { defaultPalette } from "../theme/defaultPalette.js";
import { mergePalette } from "../theme/loadCustomTheme.js";

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

describe("checkContrast with a text-side opacity modifier", () => {
  it("flags a previously-invisible violation: dark text at low opacity reads as light", () => {
    // text-gray-900 alone passes easily against white; at 30% opacity it
    // composites to a light gray that fails -- this was silently skipped
    // entirely before opacity support existed.
    const violations = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-900/30", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].ratio).toBeCloseTo(1.94, 2);
  });

  it("/100 produces the same computed result as no modifier at all", () => {
    const [plain] = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-400", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    const [withModifier] = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-400/100", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(withModifier.ratio).toBe(plain.ratio);
    expect(withModifier.suggestion).toBe(plain.suggestion);
    expect(withModifier.suggestedRatio).toBe(plain.suggestedRatio);
  });

  it("clamps an out-of-range percentage to 100 instead of skipping it (matches real browser clamping)", () => {
    const [over100] = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-400/150", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    const [at100] = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-400/100", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(over100.ratio).toBe(at100.ratio);
  });

  it("treats exactly 0% opacity as unresolvable, like text-transparent -- not an unconditional violation", () => {
    const violations = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-400/0", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(violations).toEqual([]);
  });

  it("still skips when the background itself has an opacity modifier (unknown backdrop, out of scope)", () => {
    const violations = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-400/50", bgColorClass: "bg-white/50", bgSource: "self" },
    ]);
    expect(violations).toEqual([]);
  });

  it("fails safe on a shape the extractor could never produce (double opacity suffix)", () => {
    const violations = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-400/50/50", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(violations).toEqual([]);
  });

  it("composes end-to-end with extractChecks through the full pipeline", () => {
    const code = `
      const C = () => (
        <div className="bg-white">
          <p className="text-gray-900/30">low contrast once you account for opacity</p>
        </div>
      );
    `;
    const violations = checkContrast(extractChecks(code, "fake.tsx"));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ textClass: "text-gray-900/30", bgClass: "bg-white" });
    expect(violations[0].ratio).toBeCloseTo(1.94, 2);
  });

  it("resolves a semantic color with opacity (text-white/NN) end-to-end -- the most common real idiom", () => {
    // Caught in independent review: the extraction regex originally only let
    // scale-shade/NN tokens (text-gray-400/50) through with the opacity
    // suffix intact -- text-white/NN and text-black/NN, arguably the more
    // common real pattern, were silently dropped before ever reaching this
    // opacity logic. Fixed in extractClasses.ts's COLOR_TOKEN regex.
    const code = `const C = () => <p className="text-white/40 bg-gray-800">dim text on dark background</p>;`;
    const violations = checkContrast(extractChecks(code, "fake.tsx"));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ textClass: "text-white/40", bgClass: "bg-gray-800" });
    expect(violations[0].ratio).toBeCloseTo(3.63, 2);
  });

  it("does not let a trailing gradient-angle utility mask a real violation end-to-end (regression)", () => {
    // Caught in independent review: bg-linear-45 (Tailwind v4's gradient-angle
    // utility) shared the word-number shape with a color token in
    // extractClasses.ts's COLOR_TOKEN, so it won last-token-wins over the real
    // bg-red-500 and the whole check silently vanished. Fixed by adding
    // "linear"/"conic" to NON_COLOR_SCALE_NAMES.
    const code = `const C = () => <p className="text-gray-400 bg-red-500 bg-linear-45">low contrast</p>;`;
    const violations = checkContrast(extractChecks(code, "fake.tsx"));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ textClass: "text-gray-400", bgClass: "bg-red-500" });
  });
});

describe("checkContrast with a custom palette", () => {
  const customPalette = mergePalette(defaultPalette, { brand: { "500": "#9ca3af" } }); // same hex as gray-400

  it("resolves a custom-theme color that a default-palette-only call would skip", () => {
    const violations = checkContrast(
      [{ file: "f.tsx", line: 1, textColorClass: "text-brand-500", bgColorClass: "bg-white", bgSource: "self" }],
      customPalette
    );
    expect(violations).toHaveLength(1);
  });

  it("still skips the same class when no custom palette is passed", () => {
    const violations = checkContrast([
      { file: "f.tsx", line: 1, textColorClass: "text-brand-500", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(violations).toEqual([]);
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

  // Caught in independent adversarial testing: this used to report
  // "bg-gray-800/50 is not a recognized color," even though gray-800 is a
  // perfectly recognized default-palette color -- the real, distinct
  // reason is that background-side opacity compositing is out of scope,
  // not that the color itself is unknown. A developer reading the old
  // message would reasonably (and pointlessly) try defining a theme entry
  // for a color that was never the problem.
  it("distinguishes a recognized color with an unresolved bg-side opacity from a genuinely unrecognized color", () => {
    const [recognizedSkip] = checkContrastValueSkips([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-500", bgColorClass: "bg-gray-800/50", bgSource: "self" },
    ]);
    expect(recognizedSkip.reason).toContain("bg-gray-800/50");
    expect(recognizedSkip.reason).toContain("recognized color");
    expect(recognizedSkip.reason).not.toContain("not a recognized color");

    const [unrecognizedSkip] = checkContrastValueSkips([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-500", bgColorClass: "bg-brand-500/50", bgSource: "self" },
    ]);
    expect(unrecognizedSkip.reason).toContain("bg-brand-500/50");
    expect(unrecognizedSkip.reason).toContain("not a recognized color");
  });

  it("does not report a skip for a fully resolvable pair", () => {
    const skips = checkContrastValueSkips([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-400", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(skips).toEqual([]);
  });

  it("does not report a skip once a custom palette resolves the color", () => {
    const customPalette = mergePalette(defaultPalette, { brand: { "500": "#9ca3af" } });
    const skips = checkContrastValueSkips(
      [{ file: "f.tsx", line: 1, textColorClass: "text-brand-500", bgColorClass: "bg-white", bgSource: "self" }],
      customPalette
    );
    expect(skips).toEqual([]);
  });

  it("reports a distinct reason for exactly 0% opacity (not a generic 'unrecognized color')", () => {
    const skips = checkContrastValueSkips([
      { file: "f.tsx", line: 1, textColorClass: "text-gray-400/0", bgColorClass: "bg-white", bgSource: "self" },
    ]);
    expect(skips).toHaveLength(1);
    expect(skips[0].reason).toContain("text-gray-400/0");
    expect(skips[0].reason).toContain("fully transparent");
  });

  it("attributes a both-sides-unresolvable case to bg first (deliberate resolution order, not a random tie)", () => {
    const skips = checkContrastValueSkips([
      { file: "f.tsx", line: 1, textColorClass: "text-brand-500", bgColorClass: "bg-brand-50", bgSource: "self" },
    ]);
    expect(skips).toHaveLength(1);
    expect(skips[0].reason).toContain("bg-brand-50");
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

  it("returns null at 50% opacity on white -- no gray shade (not even black) reaches 4.5:1 at that alpha", () => {
    // This still returns null, but for a different reason than before opacity
    // support existed: it's now a computed result (every candidate shade was
    // actually tried and failed at 50% alpha), not a regex short-circuit.
    expect(suggestContrastFix("text-gray-400/50", "bg-white", 4.5)).toBeNull();
  });

  it("finds a fix at an opacity where one is reachable, and preserves the opacity in the suggestion", () => {
    const fix = suggestContrastFix("text-gray-400/80", "bg-white", 4.5);
    expect(fix?.textClass).toBe("text-gray-600/80");
    expect(fix?.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("returns null for exactly 0% opacity -- no shade change fixes total transparency", () => {
    expect(suggestContrastFix("text-gray-400/0", "bg-white", 4.5)).toBeNull();
  });

  it("fails safe on a shape the extractor could never produce (double opacity suffix)", () => {
    expect(suggestContrastFix("text-gray-400/50/50", "bg-white", 4.5)).toBeNull();
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

  it("finds a fix within a custom-theme scale that the default palette doesn't have", () => {
    const customPalette = mergePalette(defaultPalette, {
      brand: { "400": "#9ca3af", "700": "#374151" }, // same hex as gray-400/gray-700
    });
    const fix = suggestContrastFix("text-brand-400", "bg-white", 4.5, customPalette);
    expect(fix?.textClass).toBe("text-brand-700");
    expect(fix?.ratio).toBeGreaterThanOrEqual(4.5);
  });
});
