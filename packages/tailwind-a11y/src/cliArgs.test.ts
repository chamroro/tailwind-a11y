import { describe, expect, it } from "vitest";
import { parseArgs, getHelpText } from "./cliArgs.js";

describe("parseArgs", () => {
  it("defaults to no flags and no patterns", () => {
    expect(parseArgs([])).toEqual({ help: false, version: false, verbose: false, patterns: [] });
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
});

describe("getHelpText", () => {
  it("documents all three flags", () => {
    const text = getHelpText();
    expect(text).toContain("--verbose");
    expect(text).toContain("--version");
    expect(text).toContain("--help");
  });
});
