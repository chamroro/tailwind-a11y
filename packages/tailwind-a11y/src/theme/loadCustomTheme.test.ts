import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findTailwindConfig,
  findTailwindThemeCss,
  loadCustomTheme,
  loadThemeFromCssFile,
  mergePalette,
  mergeSpacing,
  resolveTheme,
} from "./loadCustomTheme.js";
import { defaultPalette } from "./defaultPalette.js";
import { spacingScale } from "./spacingScale.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tailwind-a11y-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("findTailwindConfig", () => {
  it("finds tailwind.config.js", () => {
    writeFileSync(join(dir, "tailwind.config.js"), "module.exports = {};");
    expect(findTailwindConfig(dir)).toBe(join(dir, "tailwind.config.js"));
  });

  it("finds tailwind.config.cjs when .js is absent", () => {
    writeFileSync(join(dir, "tailwind.config.cjs"), "module.exports = {};");
    expect(findTailwindConfig(dir)).toBe(join(dir, "tailwind.config.cjs"));
  });

  it("prefers .js over .cjs when both are present", () => {
    writeFileSync(join(dir, "tailwind.config.js"), "module.exports = {};");
    writeFileSync(join(dir, "tailwind.config.cjs"), "module.exports = {};");
    expect(findTailwindConfig(dir)).toBe(join(dir, "tailwind.config.js"));
  });

  it("finds tailwind.config.mjs when .js and .cjs are both absent", () => {
    writeFileSync(join(dir, "tailwind.config.mjs"), "export default {};");
    expect(findTailwindConfig(dir)).toBe(join(dir, "tailwind.config.mjs"));
  });

  it("prefers .js over .mjs when both are present (lowest priority)", () => {
    writeFileSync(join(dir, "tailwind.config.js"), "module.exports = {};");
    writeFileSync(join(dir, "tailwind.config.mjs"), "export default {};");
    expect(findTailwindConfig(dir)).toBe(join(dir, "tailwind.config.js"));
  });

  it("prefers .cjs over .mjs when both are present (lowest priority, transitively)", () => {
    writeFileSync(join(dir, "tailwind.config.cjs"), "module.exports = {};");
    writeFileSync(join(dir, "tailwind.config.mjs"), "export default {};");
    expect(findTailwindConfig(dir)).toBe(join(dir, "tailwind.config.cjs"));
  });

  it("returns null when none exist", () => {
    expect(findTailwindConfig(dir)).toBeNull();
  });
});

describe("findTailwindThemeCss", () => {
  it("finds app/globals.css", () => {
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app/globals.css"), "@theme {}");
    expect(findTailwindThemeCss(dir)).toBe(join(dir, "app/globals.css"));
  });

  it("finds src/app/globals.css when app/globals.css is absent", () => {
    mkdirSync(join(dir, "src/app"), { recursive: true });
    writeFileSync(join(dir, "src/app/globals.css"), "@theme {}");
    expect(findTailwindThemeCss(dir)).toBe(join(dir, "src/app/globals.css"));
  });

  it("finds bare globals.css only as a last resort", () => {
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app/globals.css"), "@theme {}");
    writeFileSync(join(dir, "globals.css"), "@theme {}");
    expect(findTailwindThemeCss(dir)).toBe(join(dir, "app/globals.css"));
  });

  it("returns null when no candidate exists", () => {
    expect(findTailwindThemeCss(dir)).toBeNull();
  });
});

describe("loadThemeFromCssFile", () => {
  it("extracts @theme colors/spacing from a real file", () => {
    const cssPath = join(dir, "globals.css");
    writeFileSync(
      cssPath,
      `@theme {
        --color-brand-500: #3490dc;
        --spacing-18: 4.5rem;
      }`
    );
    expect(loadThemeFromCssFile(cssPath)).toEqual({
      colors: { brand: { "500": "#3490dc" } },
      spacing: { "18": 72 },
    });
  });

  it("returns null for a missing file", () => {
    expect(loadThemeFromCssFile(join(dir, "nope.css"))).toBeNull();
  });
});

describe("loadCustomTheme", () => {
  it("extracts theme.extend.colors and theme.extend.spacing", () => {
    const configPath = join(dir, "tailwind.config.js");
    writeFileSync(
      configPath,
      `module.exports = { theme: { extend: {
        colors: { brand: { 500: "#3490dc" } },
        spacing: { "18": "4.5rem" },
      } } };`
    );
    expect(loadCustomTheme(configPath)).toEqual({
      colors: { brand: { "500": "#3490dc" } },
      spacing: { "18": 72 },
    });
  });

  it("returns {} for a config with no theme.extend", () => {
    const configPath = join(dir, "tailwind.config.js");
    writeFileSync(configPath, "module.exports = {};");
    expect(loadCustomTheme(configPath)).toEqual({});
  });

  it("returns null for a missing file", () => {
    expect(loadCustomTheme(join(dir, "nope.js"))).toBeNull();
  });

  it("returns null for a config that throws on load", () => {
    const configPath = join(dir, "tailwind.config.js");
    writeFileSync(configPath, "throw new Error('boom');");
    expect(loadCustomTheme(configPath)).toBeNull();
  });

  it('returns null for a CJS config in a "type": "module" project (ERR_REQUIRE_ESM)', () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
    const configPath = join(dir, "tailwind.config.js");
    writeFileSync(configPath, "module.exports = { theme: { extend: {} } };");
    expect(loadCustomTheme(configPath)).toBeNull();
  });

  it("skips a flat string color value (no class syntax would ever resolve it)", () => {
    const configPath = join(dir, "tailwind.config.js");
    writeFileSync(configPath, `module.exports = { theme: { extend: { colors: { brand: "#3490dc" } } } };`);
    expect(loadCustomTheme(configPath)).toEqual({});
  });

  it("skips a DEFAULT key within a color scale but keeps the real shades", () => {
    const configPath = join(dir, "tailwind.config.js");
    writeFileSync(
      configPath,
      `module.exports = { theme: { extend: { colors: { brand: { DEFAULT: "#3490dc", 500: "#3490dc" } } } } };`
    );
    expect(loadCustomTheme(configPath)).toEqual({ colors: { brand: { "500": "#3490dc" } } });
  });

  it("skips a non-hex color value", () => {
    const configPath = join(dir, "tailwind.config.js");
    writeFileSync(
      configPath,
      `module.exports = { theme: { extend: { colors: { brand: { 500: "rgb(52 144 220)" } } } } };`
    );
    expect(loadCustomTheme(configPath)).toEqual({});
  });

  it("resolves an oklch() color value to its hex equivalent", () => {
    const configPath = join(dir, "tailwind.config.js");
    writeFileSync(
      configPath,
      `module.exports = { theme: { extend: { colors: { brand: { 500: "oklch(0.7 0.15 180)" } } } } };`
    );
    expect(loadCustomTheme(configPath)).toEqual({ colors: { brand: { "500": "#00bca2" } } });
  });

  it("skips a non-rem/px spacing value", () => {
    const configPath = join(dir, "tailwind.config.js");
    writeFileSync(configPath, `module.exports = { theme: { extend: { spacing: { "18": "50%" } } } };`);
    expect(loadCustomTheme(configPath)).toEqual({});
  });

  it("resolves theme.extend.colors/spacing from a real .mjs (ESM) config", () => {
    const configPath = join(dir, "tailwind.config.mjs");
    writeFileSync(
      configPath,
      `export default { theme: { extend: {
        colors: { brand: { 500: "#3490dc" } },
        spacing: { "18": "4.5rem" },
      } } };`
    );
    expect(loadCustomTheme(configPath)).toEqual({
      colors: { brand: { "500": "#3490dc" } },
      spacing: { "18": 72 },
    });
  });

  // Caught in independent review: a structural check ("does this object
  // have a `default` key") instead of gating strictly on the .mjs
  // extension would silently misfire here, discarding the real theme with
  // no error -- a .cjs config's own top-level `default` key is unrelated
  // to Node's ESM interop shape and must never be unwrapped.
  it("does not mistake a CJS config's own top-level `default` key for ESM interop", () => {
    const configPath = join(dir, "tailwind.config.cjs");
    writeFileSync(
      configPath,
      `module.exports = { default: "unrelated string", theme: { extend: { colors: { brand: { 500: "#3490dc" } } } } };`
    );
    expect(loadCustomTheme(configPath)).toEqual({ colors: { brand: { "500": "#3490dc" } } });
  });

  it("does not throw when busting the cache for a .mjs config on a second load", () => {
    // Documented limitation, not a regression to fix here: Node's
    // synchronous require(esm) caches the module in its own internal ESM
    // registry, not (only) require.cache, so deleting the require.cache
    // entry doesn't force a reload the way it does for .js/.cjs -- this
    // only asserts the second load doesn't crash, not that it picks up
    // the edit.
    const configPath = join(dir, "tailwind.config.mjs");
    writeFileSync(configPath, `export default { theme: { extend: { colors: { brand: { 500: "#111111" } } } } };`);
    expect(loadCustomTheme(configPath)).toEqual({ colors: { brand: { "500": "#111111" } } });

    writeFileSync(configPath, `export default { theme: { extend: { colors: { brand: { 500: "#222222" } } } } };`);
    expect(() => loadCustomTheme(configPath)).not.toThrow();
  });

  it("reflects an edit to the same path (require cache is busted)", () => {
    const configPath = join(dir, "tailwind.config.js");
    writeFileSync(
      configPath,
      `module.exports = { theme: { extend: { colors: { brand: { 500: "#111111" } } } } };`
    );
    expect(loadCustomTheme(configPath)).toEqual({ colors: { brand: { "500": "#111111" } } });

    writeFileSync(
      configPath,
      `module.exports = { theme: { extend: { colors: { brand: { 500: "#222222" } } } } };`
    );
    expect(loadCustomTheme(configPath)).toEqual({ colors: { brand: { "500": "#222222" } } });
  });

  it("reflects an edit to a file the config itself requires (regression: nested require-cache busting)", () => {
    const configPath = join(dir, "tailwind.config.js");
    const colorsPath = join(dir, "colors.js");
    writeFileSync(colorsPath, `module.exports = { brand: { 500: "#111111" } };`);
    writeFileSync(
      configPath,
      `module.exports = { theme: { extend: { colors: require("./colors.js") } } };`
    );
    expect(loadCustomTheme(configPath)).toEqual({ colors: { brand: { "500": "#111111" } } });

    writeFileSync(colorsPath, `module.exports = { brand: { 500: "#222222" } };`);
    expect(loadCustomTheme(configPath)).toEqual({ colors: { brand: { "500": "#222222" } } });
  });

  it("still works when the engine is esbuild-bundled to CJS (regression: import.meta rewritten to {})", async () => {
    // esbuild's CJS output (the VS Code extension and GitHub Action bundles)
    // rewrites import.meta to an empty object -- createRequire(import.meta.url)
    // throws inside such a bundle, and this function's own try/catch would
    // swallow that into a silent "no config found" fallback (custom themes
    // would silently never load in any bundled adapter). Reproduce the real
    // bundling context: bundle this module to CJS, run it, load a config.
    const { build } = await import("esbuild");
    const entryPath = join(dir, "entry.js");
    const bundlePath = join(dir, "bundle.cjs");
    const configPath = join(dir, "tailwind.config.js");
    writeFileSync(configPath, `module.exports = { theme: { extend: { colors: { brand: { 500: "#123456" } } } } };`);
    writeFileSync(
      entryPath,
      `import { loadCustomTheme } from "${join(import.meta.dirname, "loadCustomTheme.ts").split("\\").join("/")}";
       console.log(JSON.stringify(loadCustomTheme(${JSON.stringify(configPath)})));`
    );
    await build({ entryPoints: [entryPath], bundle: true, outfile: bundlePath, platform: "node", format: "cjs" });

    const { execFileSync } = await import("node:child_process");
    const output = execFileSync(process.execPath, [bundlePath], { encoding: "utf8" }).trim();
    expect(JSON.parse(output)).toEqual({ colors: { brand: { "500": "#123456" } } });
  });
});

describe("mergePalette", () => {
  it("returns base unchanged when extend is undefined", () => {
    expect(mergePalette(defaultPalette)).toBe(defaultPalette);
  });

  it("adds a new scale wholesale", () => {
    const merged = mergePalette(defaultPalette, { brand: { "500": "#3490dc" } });
    expect(merged.brand).toEqual({ "500": "#3490dc" });
    expect(merged.gray).toBe(defaultPalette.gray);
  });

  it("extends an existing scale without dropping its other shades", () => {
    const merged = mergePalette(defaultPalette, { gray: { "1000": "#000000" } });
    expect(merged.gray["1000"]).toBe("#000000");
    expect(merged.gray["400"]).toBe(defaultPalette.gray["400"]);
  });
});

describe("mergeSpacing", () => {
  it("returns base unchanged when extend is undefined", () => {
    expect(mergeSpacing(spacingScale)).toBe(spacingScale);
  });

  it("adds new tokens alongside the defaults", () => {
    const merged = mergeSpacing(spacingScale, { "18": 72 });
    expect(merged["18"]).toBe(72);
    expect(merged["4"]).toBe(spacingScale["4"]);
  });
});

describe("resolveTheme", () => {
  it("returns the untouched defaults when rootDir is null", () => {
    expect(resolveTheme({ rootDir: null })).toEqual({ palette: defaultPalette, spacing: spacingScale });
  });

  it("returns the untouched defaults when no config is found in rootDir", () => {
    expect(resolveTheme({ rootDir: dir })).toEqual({ palette: defaultPalette, spacing: spacingScale });
  });

  it("auto-detects and merges a config found in rootDir", () => {
    writeFileSync(
      join(dir, "tailwind.config.js"),
      `module.exports = { theme: { extend: { colors: { brand: { 500: "#3490dc" } } } } };`
    );
    const result = resolveTheme({ rootDir: dir });
    expect(result.palette.brand).toEqual({ "500": "#3490dc" });
    expect(result.configError).toBeUndefined();
  });

  it("uses an explicit configPath over auto-detection", () => {
    writeFileSync(join(dir, "tailwind.config.js"), `module.exports = {};`);
    const explicitPath = join(dir, "custom.config.js");
    writeFileSync(
      explicitPath,
      `module.exports = { theme: { extend: { colors: { brand: { 500: "#abcdef" } } } } };`
    );
    const result = resolveTheme({ rootDir: dir, configPath: explicitPath });
    expect(result.palette.brand).toEqual({ "500": "#abcdef" });
  });

  it("sets configError when an explicit configPath fails to load, and still returns defaults", () => {
    const explicitPath = join(dir, "does-not-exist.js");
    const result = resolveTheme({ rootDir: dir, configPath: explicitPath });
    expect(result.palette).toBe(defaultPalette);
    expect(result.spacing).toBe(spacingScale);
    expect(result.configError).toContain(explicitPath);
  });

  it("stays silent (no configError) when auto-detection finds a broken config", () => {
    writeFileSync(join(dir, "tailwind.config.js"), "throw new Error('boom');");
    expect(resolveTheme({ rootDir: dir }).configError).toBeUndefined();
  });

  it("auto-detects and merges a Tailwind v4 CSS @theme file when no JS config exists", () => {
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(
      join(dir, "app/globals.css"),
      `@theme {
        --color-brand-500: #3490dc;
        --spacing-18: 4.5rem;
      }`
    );
    const result = resolveTheme({ rootDir: dir });
    expect(result.palette.brand).toEqual({ "500": "#3490dc" });
    expect(result.spacing["18"]).toBe(72);
    expect(result.configError).toBeUndefined();
  });

  it("prefers a JS config over an auto-detected CSS file when both exist", () => {
    writeFileSync(
      join(dir, "tailwind.config.js"),
      `module.exports = { theme: { extend: { colors: { brand: { 500: "#111111" } } } } };`
    );
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app/globals.css"), `@theme { --color-brand-500: #222222; }`);
    const result = resolveTheme({ rootDir: dir });
    expect(result.palette.brand).toEqual({ "500": "#111111" });
  });

  it("uses an explicit .css configPath over auto-detection", () => {
    writeFileSync(join(dir, "tailwind.config.js"), `module.exports = {};`);
    const explicitPath = join(dir, "custom-theme.css");
    writeFileSync(explicitPath, `@theme { --color-brand-500: #abcdef; }`);
    const result = resolveTheme({ rootDir: dir, configPath: explicitPath });
    expect(result.palette.brand).toEqual({ "500": "#abcdef" });
  });

  it("sets configError when an explicit .css configPath fails to load", () => {
    const explicitPath = join(dir, "does-not-exist.css");
    const result = resolveTheme({ rootDir: dir, configPath: explicitPath });
    expect(result.palette).toBe(defaultPalette);
    expect(result.configError).toContain(explicitPath);
  });

  it("stays silent (no configError) when auto-detected CSS has no usable @theme content", () => {
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app/globals.css"), `body { color: red; }`);
    expect(resolveTheme({ rootDir: dir }).configError).toBeUndefined();
  });
});
