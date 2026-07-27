import { describe, expect, it } from "vitest";
import { extractFocusIndicatorChecks } from "./extractFocusIndicators.js";

describe("extractFocusIndicatorChecks", () => {
  it("collects focus:/focus-visible:-scoped classes on an interactive element", () => {
    const code = `const C = () => <button className="p-2 focus:outline-none focus:ring-2">x</button>;`;
    const checks = extractFocusIndicatorChecks(code, "fake.tsx");
    expect(checks).toEqual([
      { file: "fake.tsx", line: 1, tagName: "button", focusClasses: ["focus:outline-none", "focus:ring-2"] },
    ]);
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
