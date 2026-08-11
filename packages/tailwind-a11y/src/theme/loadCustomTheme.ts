import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { defaultPalette } from "./defaultPalette.js";
import { spacingScale } from "./spacingScale.js";
import { parseColorScale, parseSpacingValue } from "./themeValueParsers.js";
import { parseThemeCss } from "./parseThemeCss.js";
import type { Palette } from "./defaultPalette.js";

const CONFIG_FILENAMES = ["tailwind.config.js", "tailwind.config.cjs"];

// v1 only looks in the given directory itself -- no ancestor-directory search.
// --config (CLI) / settings["tailwind-a11y"].configPath (ESLint) exist as
// explicit escape hatches for projects where this isn't enough. `rootDir` must
// be an absolute path.
export function findTailwindConfig(rootDir: string): string | null {
  for (const filename of CONFIG_FILENAMES) {
    const candidate = join(rootDir, filename);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// Checked in priority order, in rootDir only (no recursive walk) -- v4 has no
// single conventional filename the way v3 has tailwind.config.js, so this is
// a heuristic covering common Next.js App Router / Pages Router / Vite React
// conventions, most-specific first. `globals.css` is checked last since it's
// the most generic name and the most likely to false-positive-match a file
// that isn't actually the Tailwind entry point. --config (CLI) /
// settings["tailwind-a11y"].configPath (ESLint) / INPUT_CONFIG (Action)
// remain the escape hatch for anything else.
const CSS_THEME_CANDIDATES = [
  "app/globals.css",
  "src/app/globals.css",
  "styles/globals.css",
  "src/styles/globals.css",
  "src/index.css",
  "globals.css",
];

export function findTailwindThemeCss(rootDir: string): string | null {
  for (const rel of CSS_THEME_CANDIDATES) {
    const candidate = join(rootDir, rel);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export interface RawCustomTheme {
  colors?: Palette;
  spacing?: Record<string, number>;
}

// Loads a Tailwind v3-style tailwind.config.js/.cjs and extracts only
// `theme.extend.colors`/`theme.extend.spacing` -- v1 does not read a full
// `theme.colors`/`theme.spacing` replacement, or .mjs/.ts configs (no
// config-transpiling dependency exists in this package). Tailwind v4's
// CSS-based `@theme` config is a separate format entirely, handled by
// loadThemeFromCssFile()/parseThemeCss() below, not by this function.
// `configPath` must be an absolute path (require() resolves relative paths
// against this module's own location, not the caller's cwd).
//
// Node's require() cache is busted before loading -- recursively, for the
// config file *and* everything it required (e.g. a config that factors
// tokens into a separate `require('./colors.js')`) -- without this, a
// long-lived process (the VS Code extension host, an editor-integrated
// ESLint server) would keep serving a stale value forever after the user
// edits any file the config depends on, not just the config file itself.
function bustRequireCache(require: NodeJS.Require, mod: NodeJS.Module, seen: Set<string>): void {
  if (seen.has(mod.id)) return;
  seen.add(mod.id);
  for (const child of mod.children) bustRequireCache(require, child, seen);
  delete require.cache[mod.id];
}

// Returns null only when the file itself couldn't be loaded (missing,
// syntax error, ERR_REQUIRE_ESM for a "type": "module" project, or a config
// that throws) -- a config that loads fine but has no theme.extend colors or
// spacing returns {}, which callers must not treat as an error.
export function loadCustomTheme(configPath: string): RawCustomTheme | null {
  try {
    // createRequire is anchored to the config file itself, NOT import.meta.url:
    // esbuild's CJS output (the VS Code and GitHub Action bundles) rewrites
    // import.meta to an empty object, so createRequire(import.meta.url) throws
    // inside a bundle -- and this function's own try/catch would swallow that
    // into a silent "no config found" fallback. configPath is documented as
    // absolute, which is exactly what createRequire needs as an anchor, and it
    // also makes relative require()s inside the config resolve correctly.
    const require = createRequire(configPath);
    const resolved = require.resolve(configPath);
    const cached = require.cache[resolved];
    if (cached) bustRequireCache(require, cached, new Set());
    const config = require(resolved);
    const extend = config?.theme?.extend ?? {};

    const result: RawCustomTheme = {};

    if (extend.colors && typeof extend.colors === "object") {
      const colors: Palette = {};
      for (const [scale, value] of Object.entries(extend.colors)) {
        const shades = parseColorScale(value);
        if (shades) colors[scale] = shades;
      }
      if (Object.keys(colors).length > 0) result.colors = colors;
    }

    if (extend.spacing && typeof extend.spacing === "object") {
      const spacing: Record<string, number> = {};
      for (const [token, value] of Object.entries(extend.spacing)) {
        const px = parseSpacingValue(value);
        if (px !== null) spacing[token] = px;
      }
      if (Object.keys(spacing).length > 0) result.spacing = spacing;
    }

    return result;
  } catch {
    return null;
  }
}

// Loads a Tailwind v4 CSS file and extracts @theme colors/spacing via
// parseThemeCss(). Returns null only when the file itself couldn't be read
// (missing, permission error) -- a file that reads fine but has no @theme
// block (or nothing recognized inside one) returns {}, same contract as
// loadCustomTheme. `cssPath` must be an absolute path.
export function loadThemeFromCssFile(cssPath: string): RawCustomTheme | null {
  try {
    return parseThemeCss(readFileSync(cssPath, "utf8"));
  } catch {
    return null;
  }
}

// New scale names are added wholesale; extending an existing scale merges
// shade keys in without dropping the scale's other (default) shades.
export function mergePalette(base: Palette, extend?: Palette): Palette {
  if (!extend) return base;
  const merged: Palette = { ...base };
  for (const [scale, shades] of Object.entries(extend)) {
    merged[scale] = { ...merged[scale], ...shades };
  }
  return merged;
}

export function mergeSpacing(
  base: Record<string, number>,
  extend?: Record<string, number>
): Record<string, number> {
  return extend ? { ...base, ...extend } : base;
}

export interface ResolvedTheme {
  palette: Palette;
  spacing: Record<string, number>;
  configError?: string;
}

// configError is only ever set when a path was *explicitly* provided (CLI
// --config flag or ESLint settings) and failed to load -- auto-detected
// absence stays silent, matching the "avoid confusing noise in an unrelated
// linter run" precedent already in the ESLint plugin's index.ts. `rootDir`
// and `configPath` (if given) must be absolute paths. `configPath` may point
// at either a .js/.cjs config or a .css file with an @theme block --
// dispatched by extension below.
//
// Auto-detection tries the JS config first, CSS second: an existing project
// with a tailwind.config.js gets zero change in resolved output even if it
// also happens to have an unrelated @theme block (e.g. mid v3-to-v4
// migration, or a leftover v3 config alongside a partially-adopted v4 CSS
// file).
export function resolveTheme(opts: { rootDir: string | null; configPath?: string | null }): ResolvedTheme {
  const explicitPath = opts.configPath ?? null;
  const configPath =
    explicitPath ??
    (opts.rootDir ? (findTailwindConfig(opts.rootDir) ?? findTailwindThemeCss(opts.rootDir)) : null);

  if (!configPath) {
    return { palette: defaultPalette, spacing: spacingScale };
  }

  const custom = configPath.endsWith(".css") ? loadThemeFromCssFile(configPath) : loadCustomTheme(configPath);
  if (custom === null) {
    return explicitPath
      ? {
          palette: defaultPalette,
          spacing: spacingScale,
          configError: `could not load Tailwind config at ${explicitPath}`,
        }
      : { palette: defaultPalette, spacing: spacingScale };
  }

  return {
    palette: mergePalette(defaultPalette, custom.colors),
    spacing: mergeSpacing(spacingScale, custom.spacing),
  };
}
