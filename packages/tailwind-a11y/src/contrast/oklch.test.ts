import { describe, expect, it } from "vitest";
import { oklchToRgb } from "./oklch.js";

// Every expected value here was verified against a real headless Chrome
// (canvas + getImageData pixel readback, not getComputedStyle) during
// planning -- these are not hand-computed or estimated.
describe("oklchToRgb", () => {
  it.each([
    ["oklch(1 0 0)", { r: 255, g: 255, b: 255 }],
    ["oklch(0 0 0)", { r: 0, g: 0, b: 0 }],
    ["oklch(0.5 0 0)", { r: 99, g: 99, b: 99 }],
    ["oklch(0.628 0.258 29.23)", { r: 255, g: 0, b: 0 }],
    ["oklch(0.7 0.15 180)", { r: 0, g: 188, b: 162 }],
    ["oklch(0.9 0.05 250)", { r: 198, g: 225, b: 255 }],
    ["oklch(0.4 0.2 300)", { r: 92, g: 17, b: 160 }],
    // Intentionally out-of-gamut for sRGB -- confirms clamping matches the
    // browser exactly, not just the in-gamut cases above.
    ["oklch(0.6 0.3 30)", { r: 255, g: 0, b: 0 }],
    ["oklch(0.65 0.15 250)", { r: 58, g: 147, b: 230 }],
  ])("matches the real Chrome-rendered pixel for %s", (input, expected) => {
    expect(oklchToRgb(input)).toEqual(expected);
  });

  it("resolves percentage lightness the same as the equivalent 0-1 value", () => {
    expect(oklchToRgb("oklch(75% 0.1 150)")).toEqual(oklchToRgb("oklch(0.75 0.1 150)"));
  });

  it("resolves percentage chroma as 100% == 0.4 (the CSS Color 4 reference range)", () => {
    expect(oklchToRgb("oklch(0.7 50% 180)")).toEqual(oklchToRgb("oklch(0.7 0.2 180)"));
  });

  it("resolves a deg-suffixed hue the same as a bare degree number", () => {
    expect(oklchToRgb("oklch(0.7 0.1 180deg)")).toEqual(oklchToRgb("oklch(0.7 0.1 180)"));
  });

  it("tolerates extra internal whitespace", () => {
    expect(oklchToRgb("oklch(  0.5   0   0  )")).toEqual(oklchToRgb("oklch(0.5 0 0)"));
  });

  it.each([
    "oklch(0.7 0.1 180 / 0.5)", // alpha -- palette only stores opaque colors
    "oklch(none 0.1 180)", // the `none` keyword
    "oklch(0.7 none 180)",
    "rgb(52 144 220)",
    "var(--some-other-var)",
    "#3490dc",
    "not-a-color",
    "",
    // Malformed-but-shape-like numbers -- caught in independent review:
    // Number("0..5") is NaN, and the old [\d.]+ regex accepted this shape,
    // which would have silently produced {r:NaN,g:NaN,b:NaN} instead of
    // being rejected outright.
    "oklch(0..5 0.1 180)",
    "oklch(0.7 . 180)",
    "oklch(0.7 0.1 5.)",
  ])("returns null for unsupported or malformed input: %s", (input) => {
    expect(oklchToRgb(input)).toBeNull();
  });
});
