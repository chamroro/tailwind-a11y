import { describe, expect, it } from "vitest";
import { extractReducedMotionChecks } from "./extractReducedMotion.js";

describe("extractReducedMotionChecks", () => {
  it("collects an element with a transition base and an interaction-scoped class", () => {
    const code = `const C = () => <div className="transition-transform hover:scale-110">x</div>;`;
    const checks = extractReducedMotionChecks(code, "fake.tsx");
    expect(checks).toEqual([
      {
        file: "fake.tsx",
        line: 1,
        tagName: "div",
        classes: ["transition-transform", "hover:scale-110"],
      },
    ]);
  });

  it("is not scoped to interactive elements -- a plain div qualifies", () => {
    const code = `const C = () => <div className="transition-transform hover:scale-110">x</div>;`;
    expect(extractReducedMotionChecks(code, "fake.tsx")).toHaveLength(1);
  });

  it("skips an element with a transition base but no interaction-scoped class", () => {
    const code = `const C = () => <div className="transition-transform">x</div>;`;
    expect(extractReducedMotionChecks(code, "fake.tsx")).toEqual([]);
  });

  it("skips an element with an interaction-scoped class but no transition base", () => {
    const code = `const C = () => <div className="hover:scale-110">x</div>;`;
    expect(extractReducedMotionChecks(code, "fake.tsx")).toEqual([]);
  });

  it("still collects when the only transition base is motion-safe:-scoped (rule decides pass/fail)", () => {
    const code = `const C = () => <div className="motion-safe:transition-transform hover:scale-110">x</div>;`;
    expect(extractReducedMotionChecks(code, "fake.tsx")).toHaveLength(1);
  });

  // Caught in independent review: variant order shouldn't matter --
  // motion-safe:hover:scale-110 and hover:motion-safe:scale-110 compile to
  // the same nested media query (verified against a real Tailwind v4
  // build), so both must be recognized as interaction-scoped, not just
  // whichever one happens to put the interaction variant last.
  it.each(["motion-safe:hover:scale-110", "hover:motion-safe:scale-110"])(
    "recognizes an interaction variant regardless of its position in a stacked variant, e.g. %s",
    (stackedClass) => {
      const code = `const C = () => <div className="transition-transform ${stackedClass}">x</div>;`;
      expect(extractReducedMotionChecks(code, "fake.tsx")).toHaveLength(1);
    }
  );

  it("recognizes focus-within: as an interaction variant", () => {
    const code = `const C = () => <div className="transition-transform focus-within:scale-110">x</div>;`;
    expect(extractReducedMotionChecks(code, "fake.tsx")).toHaveLength(1);
  });

  it("skips dynamic className without throwing", () => {
    const code = `const C = ({ x }) => <div className={x ? 'transition-transform hover:scale-110' : ''}>x</div>;`;
    expect(() => extractReducedMotionChecks(code, "fake.tsx")).not.toThrow();
    expect(extractReducedMotionChecks(code, "fake.tsx")).toEqual([]);
  });
});
