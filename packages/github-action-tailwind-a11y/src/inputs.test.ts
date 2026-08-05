import { describe, expect, it } from "vitest";
import { parseInputs } from "./inputs.js";

describe("parseInputs", () => {
  it("returns defaults when no inputs are set", () => {
    expect(parseInputs({})).toEqual({
      patterns: ["**/*.{jsx,tsx}"],
      config: null,
      failOnViolations: true,
    });
  });

  it("reads the dashed fail-on-violations env var via bracket access", () => {
    expect(parseInputs({ "INPUT_FAIL-ON-VIOLATIONS": "false" }).failOnViolations).toBe(false);
    expect(parseInputs({ "INPUT_FAIL-ON-VIOLATIONS": "true" }).failOnViolations).toBe(true);
  });

  it("treats anything other than an explicit 'false' as true (safe default)", () => {
    expect(parseInputs({ "INPUT_FAIL-ON-VIOLATIONS": "no" }).failOnViolations).toBe(true);
    expect(parseInputs({ "INPUT_FAIL-ON-VIOLATIONS": "0" }).failOnViolations).toBe(true);
    expect(parseInputs({ "INPUT_FAIL-ON-VIOLATIONS": "" }).failOnViolations).toBe(true);
  });

  it("is case-insensitive for the boolean", () => {
    expect(parseInputs({ "INPUT_FAIL-ON-VIOLATIONS": "FALSE" }).failOnViolations).toBe(false);
    expect(parseInputs({ "INPUT_FAIL-ON-VIOLATIONS": "False" }).failOnViolations).toBe(false);
  });

  it("splits multiline/whitespace-separated patterns", () => {
    expect(parseInputs({ INPUT_PATTERNS: "src/**/*.tsx\napp/**/*.jsx" }).patterns).toEqual([
      "src/**/*.tsx",
      "app/**/*.jsx",
    ]);
    expect(parseInputs({ INPUT_PATTERNS: "a.tsx  b.tsx" }).patterns).toEqual(["a.tsx", "b.tsx"]);
  });

  it("falls back to the default pattern for a whitespace-only value", () => {
    expect(parseInputs({ INPUT_PATTERNS: "   " }).patterns).toEqual(["**/*.{jsx,tsx}"]);
  });

  it("reads config and normalizes empty to null", () => {
    expect(parseInputs({ INPUT_CONFIG: "./tailwind.config.cjs" }).config).toBe("./tailwind.config.cjs");
    expect(parseInputs({ INPUT_CONFIG: "" }).config).toBeNull();
    expect(parseInputs({ INPUT_CONFIG: "  " }).config).toBeNull();
  });
});
