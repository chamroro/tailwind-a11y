import { describe, expect, it } from "vitest";
import { parseThemeCss } from "./parseThemeCss.js";

describe("parseThemeCss", () => {
  it("extracts a color scale and a spacing token from a single @theme block", () => {
    const css = `
      @theme {
        --color-brand-500: #3490dc;
        --spacing-18: 4.5rem;
      }
    `;
    expect(parseThemeCss(css)).toEqual({
      colors: { brand: { "500": "#3490dc" } },
      spacing: { "18": 72 },
    });
  });

  it("returns {} for CSS with no @theme block at all", () => {
    const css = `
      body { color: red; }
    `;
    expect(parseThemeCss(css)).toEqual({});
  });

  it("returns {} for an @theme block containing only unrelated custom properties", () => {
    const css = `
      @theme {
        --font-sans: "Inter", sans-serif;
        --radius-lg: 0.5rem;
      }
    `;
    expect(parseThemeCss(css)).toEqual({});
  });

  it("merges declarations across multiple @theme blocks in one file", () => {
    const css = `
      @theme {
        --color-brand-500: #3490dc;
      }
      /* some other rule in between */
      .foo { color: blue; }
      @theme {
        --color-brand-600: #2779bd;
        --spacing-18: 4.5rem;
      }
    `;
    expect(parseThemeCss(css)).toEqual({
      colors: { brand: { "500": "#3490dc", "600": "#2779bd" } },
      spacing: { "18": 72 },
    });
  });

  it("strips a comment before parsing, so a commented-out declaration never appears", () => {
    const css = `
      @theme {
        /* --color-brand-500: #000000; */
        --color-brand-500: #3490dc;
      }
    `;
    expect(parseThemeCss(css)).toEqual({
      colors: { brand: { "500": "#3490dc" } },
    });
  });

  it("supports the @theme inline { ... } modifier variant", () => {
    const css = `
      @theme inline {
        --color-brand-500: #3490dc;
      }
    `;
    expect(parseThemeCss(css)).toEqual({
      colors: { brand: { "500": "#3490dc" } },
    });
  });

  it("skips a bare --color-brand declaration with no shade suffix", () => {
    const css = `
      @theme {
        --color-brand: #3490dc;
        --color-accent-500: #2779bd;
      }
    `;
    expect(parseThemeCss(css)).toEqual({
      colors: { accent: { "500": "#2779bd" } },
    });
  });

  it.each(["oklch(0.6 0.2 250)", "rgb(52 144 220)", "var(--some-other-var)"])(
    "skips a non-hex color value %s",
    (value) => {
      const css = `
        @theme {
          --color-brand-500: ${value};
        }
      `;
      expect(parseThemeCss(css)).toEqual({});
    }
  );

  it("skips a non-rem/px spacing value", () => {
    const css = `
      @theme {
        --spacing-18: 50%;
      }
    `;
    expect(parseThemeCss(css)).toEqual({});
  });

  it("skips the bare --spacing global multiplier", () => {
    const css = `
      @theme {
        --spacing: 0.25rem;
      }
    `;
    expect(parseThemeCss(css)).toEqual({});
  });

  it("resolves a hyphenated scale name (--color-hot-pink-500)", () => {
    const css = `
      @theme {
        --color-hot-pink-500: #ff1493;
      }
    `;
    expect(parseThemeCss(css)).toEqual({
      colors: { "hot-pink": { "500": "#ff1493" } },
    });
  });

  it("tolerates a missing trailing semicolon on the last declaration before }", () => {
    const css = `
      @theme {
        --color-brand-500: #3490dc
      }
    `;
    expect(parseThemeCss(css)).toEqual({
      colors: { brand: { "500": "#3490dc" } },
    });
  });

  it("does not mistake @theme-looking text inside a CSS string literal for a real block (regression)", () => {
    const css = `
      .foo::before {
        content: "@theme { --color-brand-500: #3490dc; }";
      }
    `;
    expect(parseThemeCss(css)).toEqual({});
  });

  it("still extracts a real block when an unrelated string elsewhere contains braces/colons", () => {
    const css = `
      .foo::before {
        content: "not a theme: { just text }";
      }
      @theme {
        --color-brand-500: #3490dc;
      }
    `;
    expect(parseThemeCss(css)).toEqual({
      colors: { brand: { "500": "#3490dc" } },
    });
  });

  it("returns {} for the whole file when an @theme block is missing its closing brace (regression: documents the real, safe-but-blunt fallback, not per-block recovery)", () => {
    const css = `
      @theme {
        --color-brand-500: #3490dc;

      @theme {
        --color-accent-500: #2779bd;
      }

      .unrelated { color: red; }
    `;
    expect(parseThemeCss(css)).toEqual({});
  });

  it("extracts a combined realistic fixture end to end", () => {
    const css = `
      @import "tailwindcss";

      @theme {
        --color-brand-50: #eff6ff;
        --color-brand-500: #3490dc;
        --color-brand-900: #1e3a5f;
        --color-accent-500: #2779bd;
        --spacing-18: 4.5rem;
        --spacing-112: 28rem;
        --font-display: "Satoshi", sans-serif;
      }
    `;
    expect(parseThemeCss(css)).toEqual({
      colors: {
        brand: { "50": "#eff6ff", "500": "#3490dc", "900": "#1e3a5f" },
        accent: { "500": "#2779bd" },
      },
      spacing: { "18": 72, "112": 448 },
    });
  });
});
