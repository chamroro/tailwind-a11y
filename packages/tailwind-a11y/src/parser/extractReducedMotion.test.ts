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

  it.each(["hover:animate-bounce", "hover:animate-spin", "hover:animate-ping"])(
    "collects an element with an interaction-scoped animate-* class alone, no transition base at all: %s",
    (animateClass) => {
      const code = `const C = () => <div className="${animateClass}">x</div>;`;
      expect(extractReducedMotionChecks(code, "fake.tsx")).toEqual([
        { file: "fake.tsx", line: 1, tagName: "div", classes: [animateClass] },
      ]);
    }
  );

  it("skips an unscoped animate-* class with no interaction variant anywhere on the element", () => {
    const code = `const C = () => <div className="animate-bounce">x</div>;`;
    expect(extractReducedMotionChecks(code, "fake.tsx")).toEqual([]);
  });

  // The extractor-level pitfall this design deliberately avoids: an unscoped,
  // continuously-running animate-* sitting next to an unrelated hover class
  // on the same element must NOT become a candidate just because both
  // conditions are present somewhere on the element -- the animate-* class
  // itself must be the one that's interaction-scoped.
  it("skips an unscoped animate-* alongside an unrelated interaction-scoped class on the same element", () => {
    const code = `const C = () => <div className="animate-bounce hover:text-red-500">x</div>;`;
    expect(extractReducedMotionChecks(code, "fake.tsx")).toEqual([]);
  });

  it.each(["motion-safe:hover:animate-bounce", "hover:motion-safe:animate-bounce"])(
    "still collects when the interaction-scoped animate-* is itself motion-safe:-guarded, in either variant order: %s (rule decides pass/fail)",
    (stackedClass) => {
      const code = `const C = () => <div className="${stackedClass}">x</div>;`;
      expect(extractReducedMotionChecks(code, "fake.tsx")).toHaveLength(1);
    }
  );

  it("still collects an interaction-scoped animate-pulse -- extractor doesn't pre-filter which animate-* names are real motion, the rule does", () => {
    const code = `const C = () => <div className="hover:animate-pulse">x</div>;`;
    expect(extractReducedMotionChecks(code, "fake.tsx")).toHaveLength(1);
  });

  it.each([
    "group-hover:scale-110",
    "group-focus:scale-110",
    "group-focus-visible:scale-110",
    "group-focus-within:scale-110",
    "group-active:scale-110",
    "peer-hover:scale-110",
    "peer-focus:scale-110",
    "peer-focus-visible:scale-110",
    "peer-focus-within:scale-110",
    "peer-active:scale-110",
  ])("recognizes %s as an interaction variant on the transition path", (groupClass) => {
    const code = `const C = () => <div className="transition-transform ${groupClass}">x</div>;`;
    expect(extractReducedMotionChecks(code, "fake.tsx")).toHaveLength(1);
  });

  it.each(["group-hover:animate-bounce", "peer-hover:animate-bounce"])(
    "recognizes %s as an interaction variant on the animate path, no transition base at all",
    (animateClass) => {
      const code = `const C = () => <div className="${animateClass}">x</div>;`;
      expect(extractReducedMotionChecks(code, "fake.tsx")).toHaveLength(1);
    }
  );

  it("recognizes a named group variant (group-hover/sidebar:) as an interaction variant", () => {
    const code = `const C = () => <div className="transition-transform group-hover/sidebar:scale-110">x</div>;`;
    expect(extractReducedMotionChecks(code, "fake.tsx")).toHaveLength(1);
  });

  it.each(["motion-safe:group-hover:scale-110", "group-hover:motion-safe:scale-110"])(
    "recognizes group-hover: regardless of its position relative to motion-safe:, e.g. %s (rule decides pass/fail)",
    (stackedClass) => {
      const code = `const C = () => <div className="transition-transform ${stackedClass}">x</div>;`;
      expect(extractReducedMotionChecks(code, "fake.tsx")).toHaveLength(1);
    }
  );

  it("does not treat a near-miss variant as interaction-scoped -- exact-or-prefix-before-slash only, not a substring match", () => {
    const code = `const C = () => <div className="transition-transform group-hoverish:scale-110">x</div>;`;
    expect(extractReducedMotionChecks(code, "fake.tsx")).toEqual([]);
  });

  it("skips a plain group marker class with no group-hover: variant anywhere", () => {
    const code = `const C = () => <div className="group transition-transform">x</div>;`;
    expect(extractReducedMotionChecks(code, "fake.tsx")).toEqual([]);
  });
});
