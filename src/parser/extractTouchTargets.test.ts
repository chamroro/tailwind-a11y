import { describe, expect, it } from "vitest";
import { extractTouchTargetChecks } from "./extractTouchTargets.js";

describe("extractTouchTargetChecks", () => {
  it("catches a 16x16 button", () => {
    const code = `const C = () => <button className="w-4 h-4">x</button>;`;
    const checks = extractTouchTargetChecks(code, "fake.tsx");
    expect(checks).toEqual([
      { file: "fake.tsx", line: 1, tagName: "button", widthClass: "w-4", heightClass: "h-4", widthPx: 16, heightPx: 16 },
    ]);
  });

  it("resolves an exactly-24x24 button (boundary case)", () => {
    const code = `const C = () => <button className="w-6 h-6">x</button>;`;
    const checks = extractTouchTargetChecks(code, "fake.tsx");
    expect(checks[0]).toMatchObject({ widthPx: 24, heightPx: 24 });
  });

  it("catches a non-standard tag made interactive via onClick", () => {
    const code = `const C = () => <div onClick={fn} className="w-4 h-4">x</div>;`;
    const checks = extractTouchTargetChecks(code, "fake.tsx");
    expect(checks).toEqual([
      { file: "fake.tsx", line: 1, tagName: "div", widthClass: "w-4", heightClass: "h-4", widthPx: 16, heightPx: 16 },
    ]);
  });

  it("skips when only one dimension is set", () => {
    const code = `const C = () => <button className="w-4">x</button>;`;
    expect(extractTouchTargetChecks(code, "fake.tsx")).toEqual([]);
  });

  it("skips arbitrary, keyword, and fraction values", () => {
    const code = `
      const A = () => <button className="w-[3rem] h-[3rem]">x</button>;
      const B = () => <button className="w-full h-screen">x</button>;
      const C = () => <button className="w-1/2 h-1/2">x</button>;
    `;
    expect(extractTouchTargetChecks(code, "fake.tsx")).toEqual([]);
  });

  it("skips dynamic className without throwing", () => {
    const code = `const C = ({ small }) => <button className={small ? 'w-4 h-4' : 'w-8 h-8'}>x</button>;`;
    expect(() => extractTouchTargetChecks(code, "fake.tsx")).not.toThrow();
    expect(extractTouchTargetChecks(code, "fake.tsx")).toEqual([]);
  });

  it("skips min-w-*/min-h-* only, not treated as a fallback", () => {
    const code = `const C = () => <button className="min-w-6 h-4">x</button>;`;
    expect(extractTouchTargetChecks(code, "fake.tsx")).toEqual([]);
  });

  it("does not let a hover: variant size overwrite the real resting-state size (regression)", () => {
    const code = `const C = () => <button className="hover:w-24 w-4 h-4">x</button>;`;
    const checks = extractTouchTargetChecks(code, "fake.tsx");
    expect(checks).toEqual([
      { file: "fake.tsx", line: 1, tagName: "button", widthClass: "w-4", heightClass: "h-4", widthPx: 16, heightPx: 16 },
    ]);
  });

  it("ignores non-interactive elements", () => {
    const code = `const C = () => <div className="w-4 h-4">x</div>;`;
    expect(extractTouchTargetChecks(code, "fake.tsx")).toEqual([]);
  });
});
