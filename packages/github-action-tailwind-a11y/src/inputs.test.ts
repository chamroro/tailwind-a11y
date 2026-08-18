import { describe, expect, it } from "vitest";
import { parseInputs } from "./inputs.js";

describe("parseInputs", () => {
  it("returns defaults when no inputs are set", () => {
    expect(parseInputs({})).toEqual({
      patterns: ["**/*.{jsx,tsx}"],
      config: null,
      failOnViolations: true,
      strict: false,
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

  it("reads the strict input, opt-in (opposite default direction from fail-on-violations)", () => {
    expect(parseInputs({ INPUT_STRICT: "true" }).strict).toBe(true);
    expect(parseInputs({ INPUT_STRICT: "false" }).strict).toBe(false);
    expect(parseInputs({}).strict).toBe(false);
  });

  it("treats anything other than an explicit 'true' as false for strict (safe default)", () => {
    expect(parseInputs({ INPUT_STRICT: "yes" }).strict).toBe(false);
    expect(parseInputs({ INPUT_STRICT: "1" }).strict).toBe(false);
    expect(parseInputs({ INPUT_STRICT: "" }).strict).toBe(false);
  });

  it("is case-insensitive for strict", () => {
    expect(parseInputs({ INPUT_STRICT: "TRUE" }).strict).toBe(true);
    expect(parseInputs({ INPUT_STRICT: "True" }).strict).toBe(true);
  });
});
