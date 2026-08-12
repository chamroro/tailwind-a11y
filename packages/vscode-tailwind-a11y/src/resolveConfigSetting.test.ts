import { describe, expect, it } from "vitest";
import { resolveConfigPathSetting } from "./resolveConfigSetting.js";

describe("resolveConfigPathSetting", () => {
  it("returns null when raw is undefined", () => {
    expect(resolveConfigPathSetting(undefined, "/repo")).toBeNull();
  });

  it("returns null when raw is an empty string", () => {
    expect(resolveConfigPathSetting("", "/repo")).toBeNull();
  });

  it("resolves a relative raw against rootDir", () => {
    expect(resolveConfigPathSetting("./config/tailwind.config.cjs", "/repo")).toBe(
      "/repo/config/tailwind.config.cjs"
    );
  });

  it("resolves a relative raw pointing at a CSS file against rootDir", () => {
    expect(resolveConfigPathSetting("app/globals.css", "/repo")).toBe("/repo/app/globals.css");
  });

  it("returns null for a relative raw when rootDir is null (nothing to resolve against)", () => {
    expect(resolveConfigPathSetting("./tailwind.config.cjs", null)).toBeNull();
  });

  it("returns an already-absolute raw as-is even when rootDir is null", () => {
    expect(resolveConfigPathSetting("/abs/tailwind.config.cjs", null)).toBe("/abs/tailwind.config.cjs");
  });

  it("returns an already-absolute raw unchanged even when rootDir is present", () => {
    expect(resolveConfigPathSetting("/abs/tailwind.config.cjs", "/repo")).toBe("/abs/tailwind.config.cjs");
  });
});
