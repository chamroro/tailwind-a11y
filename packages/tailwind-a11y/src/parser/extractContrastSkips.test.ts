import { describe, expect, it } from "vitest";
import { extractContrastSkips } from "./extractClasses.js";

describe("extractContrastSkips", () => {
  it("flags the component-boundary case: parent is a capitalized custom component with no bg", () => {
    const code = `
      const C = () => (
        <Card>
          <p className="text-gray-400">x</p>
        </Card>
      );
    `;
    const skips = extractContrastSkips(code, "fake.tsx");
    expect(skips).toHaveLength(1);
    expect(skips[0].reason).toContain("<Card>");
    expect(skips[0].reason).toContain("text-gray-400");
  });

  it("flags when there is no background anywhere (lowercase parent, no bg)", () => {
    const code = `
      const C = () => (
        <section>
          <p className="text-gray-400">x</p>
        </section>
      );
    `;
    const skips = extractContrastSkips(code, "fake.tsx");
    expect(skips).toHaveLength(1);
    expect(skips[0].reason).toContain("no background utility found");
  });

  it("does not flag a case extractChecks already resolves (same-element)", () => {
    const code = `const C = () => <p className="text-gray-400 bg-white">x</p>;`;
    expect(extractContrastSkips(code, "fake.tsx")).toEqual([]);
  });

  it("does not flag a case extractChecks already resolves (direct-parent)", () => {
    const code = `
      const C = () => (
        <div className="bg-white">
          <p className="text-gray-400">x</p>
        </div>
      );
    `;
    expect(extractContrastSkips(code, "fake.tsx")).toEqual([]);
  });

  it("does not flag elements with no text color at all", () => {
    const code = `const C = () => <Card><p className="p-4">x</p></Card>;`;
    expect(extractContrastSkips(code, "fake.tsx")).toEqual([]);
  });

  it("skips dynamic className without throwing", () => {
    const code = `const C = ({ x }) => <p className={x ? 'text-gray-400' : ''}>x</p>;`;
    expect(() => extractContrastSkips(code, "fake.tsx")).not.toThrow();
    expect(extractContrastSkips(code, "fake.tsx")).toEqual([]);
  });
});
