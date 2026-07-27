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
});
