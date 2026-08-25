import { describe, expect, it } from "vitest";
import { applyAlpha, contrastRatio, hexToRgb, meetsWCAG, relativeLuminance, requiredRatio, rgbToHex } from "./luminance.js";

describe("hexToRgb", () => {
  it("parses 6-digit hex with #", () => {
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("parses 6-digit hex without #", () => {
    expect(hexToRgb("000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("expands 3-digit hex", () => {
    expect(hexToRgb("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it("returns null for malformed input", () => {
    expect(hexToRgb("not-a-color")).toBeNull();
    expect(hexToRgb("#12345")).toBeNull();
    expect(hexToRgb("")).toBeNull();
  });
});

describe("rgbToHex", () => {
  it("is the exact inverse of hexToRgb for round-trippable values", () => {
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe("#ffffff");
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(rgbToHex({ r: 0xaa, g: 0xbb, b: 0xcc })).toBe("#aabbcc");
  });

  it("pads single-digit hex channels with a leading zero", () => {
    expect(rgbToHex({ r: 5, g: 0, b: 250 })).toBe("#0500fa");
  });

  it("clamps out-of-range channels rather than producing invalid hex", () => {
    expect(rgbToHex({ r: 300, g: -10, b: 128 })).toBe("#ff0080");
  });
});

describe("relativeLuminance", () => {
  it("white is 1, black is 0", () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
  });
});

describe("contrastRatio", () => {
  it("white vs black is 21:1", () => {
    const ratio = contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 });
    expect(ratio).toBeCloseTo(21, 1);
  });

  it("is symmetric regardless of argument order", () => {
    const white = { r: 255, g: 255, b: 255 };
    const black = { r: 0, g: 0, b: 0 };
    expect(contrastRatio(white, black)).toBeCloseTo(contrastRatio(black, white), 5);
  });

  it("matches the classic #767676-on-white borderline-AA example", () => {
    const ratio = contrastRatio(hexToRgb("#767676")!, hexToRgb("#ffffff")!);
    expect(ratio).toBeCloseTo(4.54, 1);
  });
});

describe("applyAlpha", () => {
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };

  it("alpha 0 returns the background unchanged", () => {
    expect(applyAlpha(black, 0, white)).toEqual(white);
  });

  it("alpha 1 returns the foreground unchanged", () => {
    expect(applyAlpha(black, 1, white)).toEqual(black);
  });

  it("alpha 0.5 is the midpoint", () => {
    expect(applyAlpha(black, 0.5, white)).toEqual({ r: 128, g: 128, b: 128 });
  });

  it("blends each channel independently (catches an r/g/b copy-paste bug)", () => {
    const fg = { r: 200, g: 100, b: 0 };
    const bg = { r: 0, g: 100, b: 200 };
    expect(applyAlpha(fg, 0.5, bg)).toEqual({ r: 100, g: 100, b: 100 });
  });
});

describe("requiredRatio / meetsWCAG", () => {
  it.each([
    ["AA", false, 4.5],
    ["AA", true, 3.0],
    ["AAA", false, 7.0],
    ["AAA", true, 4.5],
  ] as const)("required ratio for %s large=%s is %s", (level, isLargeText, expected) => {
    expect(requiredRatio(level, isLargeText)).toBe(expected);
  });

  it("meetsWCAG compares against the right threshold", () => {
    expect(meetsWCAG(4.5, "AA", false)).toBe(true);
    expect(meetsWCAG(4.49, "AA", false)).toBe(false);
    expect(meetsWCAG(3.0, "AA", true)).toBe(true);
  });
});
