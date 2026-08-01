import { describe, expect, it } from "vitest";
import { parseArgs, getHelpText } from "./cliArgs.js";

describe("parseArgs", () => {
  it("defaults to no flags and no patterns", () => {
    expect(parseArgs([])).toEqual({
      help: false,
      version: false,
      verbose: false,
      config: null,
      configError: null,
      patterns: [],
    });
  });

  it("recognizes --verbose and its short form -v", () => {
    expect(parseArgs(["--verbose"]).verbose).toBe(true);
    expect(parseArgs(["-v"]).verbose).toBe(true);
  });

  it("recognizes --version and its short form -V (uppercase, distinct from -v)", () => {
    expect(parseArgs(["--version"]).version).toBe(true);
    expect(parseArgs(["-V"]).version).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(false);
  });

  it("recognizes --help and its short form -h", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("treats any non-flag argument as a glob pattern", () => {
    expect(parseArgs(["src/**/*.tsx"]).patterns).toEqual(["src/**/*.tsx"]);
  });

  it("separates flags from patterns when mixed", () => {
    const result = parseArgs(["--verbose", "src/**/*.tsx", "app/**/*.jsx"]);
    expect(result.verbose).toBe(true);
    expect(result.patterns).toEqual(["src/**/*.tsx", "app/**/*.jsx"]);
  });

  it("consumes --config's value and excludes both from patterns", () => {
    const result = parseArgs(["--config", "./tailwind.config.cjs", "src/**/*.tsx"]);
    expect(result.config).toBe("./tailwind.config.cjs");
    expect(result.configError).toBeNull();
    expect(result.patterns).toEqual(["src/**/*.tsx"]);
  });

  it("reports a usage error when --config is the last argument", () => {
    const result = parseArgs(["--config"]);
    expect(result.config).toBeNull();
    expect(result.configError).toBe("--config requires a path argument");
  });

  it("reports a usage error when --config is immediately followed by another flag", () => {
    const result = parseArgs(["--config", "--verbose"]);
    expect(result.config).toBeNull();
    expect(result.configError).toBe("--config requires a path argument");
    // The flag itself still gets recognized on its own, not swallowed.
    expect(result.verbose).toBe(true);
  });

  it("works alongside other flags and patterns in any order", () => {
    const result = parseArgs(["--verbose", "--config", "tw.config.js", "src/**/*.tsx"]);
    expect(result.verbose).toBe(true);
    expect(result.config).toBe("tw.config.js");
    expect(result.patterns).toEqual(["src/**/*.tsx"]);
  });
});

describe("getHelpText", () => {
  it("documents all flags", () => {
    const text = getHelpText();
    expect(text).toContain("--verbose");
    expect(text).toContain("--version");
    expect(text).toContain("--help");
    expect(text).toContain("--config");
  });
});
