import { describe, expect, it } from "vitest";
import { checkContrast, checkContrastValueSkips } from "./checkContrast.js";
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
