import { describe, expect, it } from "vitest";
import { extractFocusIndicatorChecks } from "./extractFocusIndicators.js";

describe("extractFocusIndicatorChecks", () => {
  it("collects focus:/focus-visible:-scoped classes on an interactive element", () => {
    const code = `const C = () => <button className="p-2 focus:outline-none focus:ring-2">x</button>;`;
    const checks = extractFocusIndicatorChecks(code, "fake.tsx");
    expect(checks).toEqual([
      {
        file: "fake.tsx",
        line: 1,
        tagName: "button",
        focusClasses: ["focus:outline-none", "focus:ring-2"],
        bgClass: null,
        bgSource: null,
      },
    ]);
  });

  it("resolves bg from the element's own class", () => {
    const code = `const C = () => <button className="bg-blue-500 focus:ring-2 focus:ring-white">x</button>;`;
    const [check] = extractFocusIndicatorChecks(code, "fake.tsx");
    expect(check.bgClass).toBe("bg-blue-500");
    expect(check.bgSource).toBe("self");
  });

  it("falls back to the immediate parent's bg", () => {
    const code = `const C = () => <div className="bg-blue-500"><button className="focus:ring-2 focus:ring-white">x</button></div>;`;
    const [check] = extractFocusIndicatorChecks(code, "fake.tsx");
    expect(check.bgClass).toBe("bg-blue-500");
    expect(check.bgSource).toBe("parent");
  });

  it("leaves bgClass null when neither the element nor its parent has one", () => {
    const code = `const C = () => <button className="focus:ring-2 focus:ring-white">x</button>;`;
    const [check] = extractFocusIndicatorChecks(code, "fake.tsx");
    expect(check.bgClass).toBeNull();
    expect(check.bgSource).toBeNull();
  });

  it("collects focus-visible: classes too", () => {
    const code = `const C = () => <button className="focus:outline-none focus-visible:ring-2">x</button>;`;
    const checks = extractFocusIndicatorChecks(code, "fake.tsx");
    expect(checks[0].focusClasses).toEqual(["focus:outline-none", "focus-visible:ring-2"]);
  });

  it("ignores non-interactive elements", () => {
    const code = `const C = () => <div className="focus:outline-none">x</div>;`;
    expect(extractFocusIndicatorChecks(code, "fake.tsx")).toEqual([]);
  });

  it("treats a div with onClick as interactive", () => {
    const code = `const C = () => <div onClick={fn} className="focus:outline-none">x</div>;`;
    expect(extractFocusIndicatorChecks(code, "fake.tsx")).toHaveLength(1);
  });

  it("returns nothing when there are no focus:/focus-visible: classes", () => {
    const code = `const C = () => <button className="p-2 bg-white">x</button>;`;
    expect(extractFocusIndicatorChecks(code, "fake.tsx")).toEqual([]);
  });

  it("skips dynamic className without throwing", () => {
    const code = `const C = ({ x }) => <button className={x ? 'focus:outline-none' : ''}>x</button>;`;
    expect(() => extractFocusIndicatorChecks(code, "fake.tsx")).not.toThrow();
    expect(extractFocusIndicatorChecks(code, "fake.tsx")).toEqual([]);
  });
});
