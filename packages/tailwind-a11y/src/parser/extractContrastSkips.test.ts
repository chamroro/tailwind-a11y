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

  describe("placeholder:text-*", () => {
    it("flags the component-boundary case for a placeholder candidate", () => {
      const code = `
        const C = () => (
          <Card>
            <input className="placeholder:text-gray-300" />
          </Card>
        );
      `;
      const skips = extractContrastSkips(code, "fake.tsx");
      expect(skips).toHaveLength(1);
      expect(skips[0].reason).toContain("<Card>");
      expect(skips[0].reason).toContain("placeholder:text-gray-300");
    });

    it("flags when there is no background anywhere for a placeholder candidate", () => {
      const code = `
        const C = () => (
          <section>
            <input className="placeholder:text-gray-300" />
          </section>
        );
      `;
      const skips = extractContrastSkips(code, "fake.tsx");
      expect(skips).toHaveLength(1);
      expect(skips[0].reason).toContain("no background utility found");
      expect(skips[0].reason).toContain("placeholder:text-gray-300");
    });

    it("reports two independent skips when both resting text and placeholder candidates lack a background", () => {
      const code = `
        const C = () => (
          <section>
            <input className="text-gray-300 placeholder:text-gray-200" />
          </section>
        );
      `;
      const skips = extractContrastSkips(code, "fake.tsx");
      expect(skips).toHaveLength(2);
      expect(skips.map((s) => s.reason).join("\n")).toContain("text-gray-300");
      expect(skips.map((s) => s.reason).join("\n")).toContain("placeholder:text-gray-200");
    });

    it("does not flag a placeholder candidate extractChecks already resolves", () => {
      const code = `const C = () => <input className="bg-white placeholder:text-gray-300" />;`;
      expect(extractContrastSkips(code, "fake.tsx")).toEqual([]);
    });

    it("does not flag a placeholder-shaped class on a tag that can never render ::placeholder", () => {
      const code = `
        const C = () => (
          <section>
            <div className="placeholder:text-gray-300" />
          </section>
        );
      `;
      expect(extractContrastSkips(code, "fake.tsx")).toEqual([]);
    });
  });
});
