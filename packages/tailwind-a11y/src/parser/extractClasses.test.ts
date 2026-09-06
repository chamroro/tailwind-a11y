import { describe, expect, it } from "vitest";
import { extractChecks } from "./extractClasses.js";

describe("extractChecks", () => {
  it("catches a same-element text/bg combination", () => {
    const code = `const C = () => <p className="text-gray-400 bg-white">x</p>;`;
    const checks = extractChecks(code, "fake.tsx");
    expect(checks).toEqual([
      { file: "fake.tsx", line: 1, textColorClass: "text-gray-400", bgColorClass: "bg-white", bgSource: "self" },
    ]);
  });

  it("catches the direct-parent pattern (this tool's core differentiator)", () => {
    const code = `
      const C = () => (
        <div className="bg-white">
          <p className="text-gray-400">low contrast</p>
        </div>
      );
    `;
    const checks = extractChecks(code, "fake.tsx");
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      textColorClass: "text-gray-400",
      bgColorClass: "bg-white",
      bgSource: "parent",
    });
  });

  it("does not walk past the immediate parent", () => {
    const code = `
      const C = () => (
        <div className="bg-white">
          <section>
            <p className="text-gray-400">x</p>
          </section>
        </div>
      );
    `;
    expect(extractChecks(code, "fake.tsx")).toEqual([]);
  });

  it("silently skips dynamic className expressions without throwing", () => {
    const code = `
      const C = ({ isDark }) => (
        <div className={isDark ? 'bg-black' : 'bg-white'}>
          <p className="text-gray-400">x</p>
        </div>
      );
    `;
    expect(() => extractChecks(code, "fake.tsx")).not.toThrow();
    expect(extractChecks(code, "fake.tsx")).toEqual([]);
  });

  it("silently skips clsx()-composed className without throwing", () => {
    const code = `
      const C = () => (
        <p className={clsx('text-gray-400', someCondition && 'font-bold')}>x</p>
      );
    `;
    expect(() => extractChecks(code, "fake.tsx")).not.toThrow();
    expect(extractChecks(code, "fake.tsx")).toEqual([]);
  });

  it("returns an empty array for unparsable files instead of throwing", () => {
    expect(() => extractChecks("const x = {{{ not valid jsx", "broken.tsx")).not.toThrow();
    expect(extractChecks("const x = {{{ not valid jsx", "broken.tsx")).toEqual([]);
  });

  it("ignores elements with no text color class", () => {
    const code = `const C = () => <div className="bg-white p-4">x</div>;`;
    expect(extractChecks(code, "fake.tsx")).toEqual([]);
  });

  it("does not let a trailing opacity utility overwrite the real color match", () => {
    const code = `const C = () => <p className="text-gray-400 bg-white bg-opacity-50">x</p>;`;
    const checks = extractChecks(code, "fake.tsx");
    expect(checks).toEqual([
      { file: "fake.tsx", line: 1, textColorClass: "text-gray-400", bgColorClass: "bg-white", bgSource: "self" },
    ]);
  });

  it("extracts a semantic color with an opacity modifier (text-white/NN, the most common real idiom)", () => {
    const code = `const C = () => <p className="text-white/40 bg-gray-800">x</p>;`;
    const checks = extractChecks(code, "fake.tsx");
    expect(checks).toEqual([
      { file: "fake.tsx", line: 1, textColorClass: "text-white/40", bgColorClass: "bg-gray-800", bgSource: "self" },
    ]);
  });

  it("extracts an arbitrary hex color with an opacity modifier", () => {
    const code = `const C = () => <p className="text-[#eeeeee]/40 bg-gray-800">x</p>;`;
    const checks = extractChecks(code, "fake.tsx");
    expect(checks).toEqual([
      { file: "fake.tsx", line: 1, textColorClass: "text-[#eeeeee]/40", bgColorClass: "bg-gray-800", bgSource: "self" },
    ]);
  });

  it.each(["bg-linear-45", "bg-conic-180"])(
    "does not let a trailing gradient-angle utility %s overwrite the real color match (regression)",
    (decoy) => {
      const code = `const C = () => <p className="text-gray-400 bg-red-500 ${decoy}">x</p>;`;
      const checks = extractChecks(code, "fake.tsx");
      expect(checks).toEqual([
        { file: "fake.tsx", line: 1, textColorClass: "text-gray-400", bgColorClass: "bg-red-500", bgSource: "self" },
      ]);
    }
  );

  // Caught in independent review: a variant-scoped background utility
  // (dark:/hover:/etc.) written after the real resting-state one used to
  // win last-token-wins, masking a real violation entirely (the resting-
  // state bg-white vs the failing text color was never checked at all,
  // since dark:bg-gray-900 -- which text-gray-300 happens to pass against
  // -- was treated as the background instead).
  it.each(["dark:bg-gray-900", "hover:bg-gray-900", "md:bg-gray-900"])(
    "does not let a variant-scoped background %s override the real resting-state background (regression)",
    (variantScoped) => {
      const code = `const C = () => <div className="bg-white ${variantScoped}"><p className="text-gray-300">x</p></div>;`;
      const checks = extractChecks(code, "fake.tsx");
      expect(checks).toEqual([
        { file: "fake.tsx", line: 1, textColorClass: "text-gray-300", bgColorClass: "bg-white", bgSource: "parent" },
      ]);
    }
  );

  it("does not let a variant-scoped text color override the real resting-state text color (regression)", () => {
    const code = `const C = () => <p className="text-gray-300 dark:text-white bg-white">x</p>;`;
    const checks = extractChecks(code, "fake.tsx");
    expect(checks).toEqual([
      { file: "fake.tsx", line: 1, textColorClass: "text-gray-300", bgColorClass: "bg-white", bgSource: "self" },
    ]);
  });

  describe("placeholder:text-* (WCAG 1.4.3 on ::placeholder)", () => {
    it.each(["input", "textarea"])("catches a placeholder color on a same-element %s", (tag) => {
      const code = `const C = () => <${tag} className="bg-white placeholder:text-gray-300" />;`;
      const checks = extractChecks(code, "fake.tsx");
      expect(checks).toEqual([
        { file: "fake.tsx", line: 1, textColorClass: "placeholder:text-gray-300", bgColorClass: "bg-white", bgSource: "self" },
      ]);
    });

    it("produces two independent checks when both a resting text color and a placeholder color are present", () => {
      const code = `const C = () => <input className="bg-white text-gray-300 placeholder:text-gray-200" />;`;
      const checks = extractChecks(code, "fake.tsx");
      expect(checks).toHaveLength(2);
      expect(checks).toEqual(
        expect.arrayContaining([
          { file: "fake.tsx", line: 1, textColorClass: "text-gray-300", bgColorClass: "bg-white", bgSource: "self" },
          { file: "fake.tsx", line: 1, textColorClass: "placeholder:text-gray-200", bgColorClass: "bg-white", bgSource: "self" },
        ])
      );
    });

    it("last-token-wins within the placeholder candidacy", () => {
      const code = `const C = () => <input className="bg-white placeholder:text-gray-300 placeholder:text-gray-100" />;`;
      const checks = extractChecks(code, "fake.tsx");
      expect(checks).toEqual([
        { file: "fake.tsx", line: 1, textColorClass: "placeholder:text-gray-100", bgColorClass: "bg-white", bgSource: "self" },
      ]);
    });

    it("resolves the placeholder candidate via the immediate parent's background, same as resting text", () => {
      const code = `
        const C = () => (
          <div className="bg-white">
            <input className="placeholder:text-gray-400" />
          </div>
        );
      `;
      const checks = extractChecks(code, "fake.tsx");
      expect(checks).toHaveLength(1);
      expect(checks[0]).toMatchObject({
        textColorClass: "placeholder:text-gray-400",
        bgColorClass: "bg-white",
        bgSource: "parent",
      });
    });

    it("does not recognize a nested variant stacked with placeholder: (regression, deliberate v1 scope cut)", () => {
      const code = `const C = () => <input className="bg-white dark:placeholder:text-gray-500" />;`;
      expect(extractChecks(code, "fake.tsx")).toEqual([]);
    });

    it("does not recognize placeholder:text-* on a tag that can never render ::placeholder", () => {
      const code = `const C = () => <div className="bg-white placeholder:text-gray-300" />;`;
      expect(extractChecks(code, "fake.tsx")).toEqual([]);
    });

    it("ignores a non-color decoy on the placeholder path", () => {
      const code = `const C = () => <input className="bg-white placeholder:text-lg" />;`;
      expect(extractChecks(code, "fake.tsx")).toEqual([]);
    });
  });
});
