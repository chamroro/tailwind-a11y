import { describe, expect, it } from "vitest";
import { checkReducedMotion } from "./checkReducedMotion.js";
import { extractReducedMotionChecks } from "../parser/extractReducedMotion.js";

function check(classes: string[]) {
  return { file: "f.tsx", line: 1, tagName: "div", classes };
}

describe("checkReducedMotion", () => {
  it("reports nothing by default (strict not passed) even for an otherwise-real violation", () => {
    const violations = checkReducedMotion([check(["transition-transform", "hover:scale-110"])]);
    expect(violations).toEqual([]);
  });

  it("reports nothing when strict is explicitly false", () => {
    const violations = checkReducedMotion([check(["transition-transform", "hover:scale-110"])], false);
    expect(violations).toEqual([]);
  });

  it("flags an unscoped transition-transform with an interaction-scoped scale and no guard, under strict", () => {
    const violations = checkReducedMotion([check(["transition-transform", "hover:scale-110"])], true);
    expect(violations).toEqual([
      {
        type: "reduced-motion",
        mechanism: "transition",
        file: "f.tsx",
        line: 1,
        tagName: "div",
        transitionClass: "transition-transform",
        motionClass: "hover:scale-110",
        level: "AAA",
      },
    ]);
  });

  it("passes when a motion-reduce:transition-none guard is present", () => {
    const violations = checkReducedMotion(
      [check(["transition-transform", "hover:scale-110", "motion-reduce:transition-none"])],
      true
    );
    expect(violations).toEqual([]);
  });

  it("passes when a motion-reduce:transform-none guard is present", () => {
    const violations = checkReducedMotion(
      [check(["transition-transform", "hover:scale-110", "motion-reduce:transform-none"])],
      true
    );
    expect(violations).toEqual([]);
  });

  it("passes when the transition is scoped under motion-safe: instead of unscoped (complete alternative)", () => {
    const violations = checkReducedMotion([check(["motion-safe:transition-transform", "hover:scale-110"])], true);
    expect(violations).toEqual([]);
  });

  // Caught in independent adversarial testing: a transition scoped by any
  // variant other than motion-safe: was silently treated the same as
  // motion-safe:-guarded (both fell outside the old `segments.length === 0`
  // check), even though dark:/sm:/lg:/etc. have no relationship to
  // prefers-reduced-motion at all -- the transition is fully live whenever
  // that unrelated condition holds.
  it.each(["dark:transition", "sm:transition", "lg:transition-all"])(
    "flags a transition scoped by a variant unrelated to motion-safe: %s (regression)",
    (transitionClass) => {
      const violations = checkReducedMotion([check([transitionClass, "hover:scale-110"])], true);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ mechanism: "transition", transitionClass });
    }
  );

  // Caught in independent adversarial testing: sm:motion-reduce:
  // transition-none was accepted as a full guard even though it only
  // suppresses the transition at/above the sm breakpoint, leaving it
  // completely unguarded below that width -- only a bare, unconditional
  // motion-reduce: guard is trusted.
  it.each(["sm:motion-reduce:transition-none", "dark:motion-reduce:transform-none", "lg:motion-reduce:transition-none"])(
    "does not accept a motion-reduce: guard nested under an unrelated variant: %s (regression)",
    (guard) => {
      const violations = checkReducedMotion([check(["transition-transform", "hover:scale-110", guard])], true);
      expect(violations).toHaveLength(1);
    }
  );

  it("still accepts a bare, unconditional motion-reduce: guard even alongside an unrelated variant on the transition", () => {
    const violations = checkReducedMotion(
      [check(["dark:transition", "hover:scale-110", "motion-reduce:transition-none"])],
      true
    );
    expect(violations).toEqual([]);
  });

  // Caught in independent review: motion-safe:hover:scale-110 and
  // hover:motion-safe:scale-110 compile to the identical nested media query
  // (confirmed against a real Tailwind v4 build) -- both must be treated as
  // "this motion utility only applies when motion is already safe,"
  // regardless of which variant was written first.
  it.each(["motion-safe:hover:scale-110", "hover:motion-safe:scale-110"])(
    "passes when the interaction-scoped motion utility is itself motion-safe:-guarded, in either variant order: %s",
    (motionClass) => {
      const violations = checkReducedMotion([check(["transition-transform", motionClass])], true);
      expect(violations).toEqual([]);
    }
  );

  it("still flags a plain hover:scale-110 (no motion-safe: anywhere) alongside an unrelated motion-safe:-guarded class", () => {
    const violations = checkReducedMotion(
      [check(["transition-transform", "hover:scale-110", "motion-safe:hover:rotate-3"])],
      true
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].motionClass).toBe("hover:scale-110");
  });

  it("recognizes focus-within: as an interaction variant", () => {
    const violations = checkReducedMotion([check(["transition-transform", "focus-within:scale-110"])], true);
    expect(violations).toHaveLength(1);
  });

  it("does not flag transition-colors -- it doesn't animate transform/scale/rotate/translate", () => {
    const violations = checkReducedMotion([check(["transition-colors", "hover:scale-110"])], true);
    expect(violations).toEqual([]);
  });

  it("bare transition (the default property list) still counts -- it includes transform/scale/rotate/translate", () => {
    const violations = checkReducedMotion([check(["transition", "hover:scale-110"])], true);
    expect(violations).toHaveLength(1);
  });

  it("transition-all still counts", () => {
    const violations = checkReducedMotion([check(["transition-all", "hover:rotate-45"])], true);
    expect(violations).toHaveLength(1);
  });

  it.each(["hover:scale-100", "focus:rotate-0", "active:translate-x-0", "hover:-translate-y-0", "focus-visible:skew-x-0"])(
    "does not flag an identity-value interaction utility: %s",
    (identity) => {
      const violations = checkReducedMotion([check(["transition-transform", identity])], true);
      expect(violations).toEqual([]);
    }
  );

  it.each(["hover:scale-110", "hover:scale-x-125", "focus:rotate-3", "active:-rotate-6", "hover:-translate-y-1", "focus-visible:skew-x-6"])(
    "flags a real, non-identity interaction motion utility: %s",
    (motion) => {
      const violations = checkReducedMotion([check(["transition-transform", motion])], true);
      expect(violations).toHaveLength(1);
    }
  );

  it("does not flag when there's a transition but no interaction-scoped motion utility at all", () => {
    const violations = checkReducedMotion([check(["transition-transform", "hover:bg-blue-500"])], true);
    expect(violations).toEqual([]);
  });

  it("does not flag when the transition itself is hover-scoped (not present in the resting state)", () => {
    const violations = checkReducedMotion([check(["hover:transition-transform", "hover:scale-110"])], true);
    expect(violations).toEqual([]);
  });

  it("composes end-to-end with extractReducedMotionChecks", () => {
    const code = `const C = () => <div className="transition-transform hover:scale-110">x</div>;`;
    const violations = checkReducedMotion(extractReducedMotionChecks(code, "fake.tsx"), true);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("reduced-motion");
  });

  describe("animate-* mechanism", () => {
    it.each(["hover:animate-bounce", "hover:animate-spin", "hover:animate-ping"])(
      "flags an interaction-scoped animate-* class alone, with no transition base at all: %s",
      (animateClass) => {
        const violations = checkReducedMotion([check([animateClass])], true);
        expect(violations).toEqual([
          {
            type: "reduced-motion",
            mechanism: "animate",
            file: "f.tsx",
            line: 1,
            tagName: "div",
            motionClass: animateClass,
            level: "AAA",
          },
        ]);
      }
    );

    it("does not flag hover:animate-pulse -- opacity-only, not a size/shape/position change", () => {
      const violations = checkReducedMotion([check(["hover:animate-pulse"])], true);
      expect(violations).toEqual([]);
    });

    it("does not flag hover:animate-none -- the off/identity value", () => {
      const violations = checkReducedMotion([check(["hover:animate-none"])], true);
      expect(violations).toEqual([]);
    });

    it("does not flag an unscoped animate-bounce with no interaction variant (2.2.2 territory, out of scope here)", () => {
      const violations = checkReducedMotion([check(["animate-bounce"])], true);
      expect(violations).toEqual([]);
    });

    it("does not flag an unscoped animate-bounce alongside an unrelated interaction-scoped class on the same element", () => {
      const violations = checkReducedMotion([check(["animate-bounce", "hover:text-red-500"])], true);
      expect(violations).toEqual([]);
    });

    it("passes when a bare motion-reduce:animate-none guard is present", () => {
      const violations = checkReducedMotion([check(["hover:animate-bounce", "motion-reduce:animate-none"])], true);
      expect(violations).toEqual([]);
    });

    it("does not accept a motion-reduce:animate-none guard nested under an unrelated variant (regression, mirrors the transition-side guard)", () => {
      const violations = checkReducedMotion([check(["hover:animate-bounce", "sm:motion-reduce:animate-none"])], true);
      expect(violations).toHaveLength(1);
    });

    it("a bare motion-reduce:transition-none guard does not suppress an animate-mechanism violation (independent guards)", () => {
      const violations = checkReducedMotion([check(["hover:animate-bounce", "motion-reduce:transition-none"])], true);
      expect(violations).toHaveLength(1);
    });

    it.each(["motion-safe:hover:animate-bounce", "hover:motion-safe:animate-bounce"])(
      "passes when the interaction-scoped animate-* is itself motion-safe:-guarded, in either variant order: %s",
      (animateClass) => {
        const violations = checkReducedMotion([check([animateClass])], true);
        expect(violations).toEqual([]);
      }
    );

    it("still flags animate-bounce scoped by an unrelated persistent variant stacked with the interaction variant", () => {
      const violations = checkReducedMotion([check(["dark:hover:animate-bounce"])], true);
      expect(violations).toHaveLength(1);
      expect(violations[0].motionClass).toBe("dark:hover:animate-bounce");
    });

    it("produces two independent violations when an element has both a real transition violation and a real animate violation", () => {
      const violations = checkReducedMotion(
        [check(["transition-transform", "hover:scale-110", "focus:animate-bounce"])],
        true
      );
      expect(violations).toHaveLength(2);
      expect(violations.map((v) => v.mechanism).sort()).toEqual(["animate", "transition"]);
    });

    it("composes end-to-end with extractReducedMotionChecks for an animate-only element", () => {
      const code = `const C = () => <div className="hover:animate-bounce">x</div>;`;
      const violations = checkReducedMotion(extractReducedMotionChecks(code, "fake.tsx"), true);
      expect(violations).toHaveLength(1);
      expect(violations[0].mechanism).toBe("animate");
    });
  });
});
