import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { hexToRgb } from "../contrast/luminance.js";
import { defaultPalette } from "./defaultPalette.js";
import { spacingScale } from "./spacingScale.js";
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

export interface RawCustomTheme {
  colors?: Palette;
  spacing?: Record<string, number>;
}

const SPACING_RE = /^-?[\d.]+(rem|px)$/;

function parseSpacingValue(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = SPACING_RE.exec(value);
  if (!match) return null; // em/%/vw/bare number/function -- skip, don't guess
  const num = parseFloat(value);
  return match[1] === "rem" ? num * 16 : num; // matches spacingScale.ts's 16px-root assumption
}

// Only plain hex-shade objects are accepted (e.g. `brand: { 500: '#3490dc' }`).
// A flat string color (`brand: '#3490dc'`) or a `DEFAULT` key is skipped
// entirely -- there's no class syntax ("bg-brand-DEFAULT" isn't real Tailwind)
// that would ever resolve to it, so partially supporting it would be dead code.
function parseColorScale(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const shades: Record<string, string> = {};
  for (const [shade, shadeValue] of Object.entries(value)) {
    if (shade === "DEFAULT") continue; // no "bg-brand-DEFAULT" class syntax exists to resolve it
    if (typeof shadeValue !== "string") continue;
    if (hexToRgb(shadeValue) === null) continue; // not a hex value -- skip, don't guess
    shades[shade] = shadeValue;
  }
  return Object.keys(shades).length > 0 ? shades : null;
}

// Loads a tailwind.config.js/.cjs and extracts only `theme.extend.colors` /
// `theme.extend.spacing` -- v1 does not read a full `theme.colors`/`theme.spacing`
// replacement, Tailwind v4's CSS-based `@theme` config, or .mjs/.ts configs (no
// config-transpiling dependency exists in this package). `configPath` must be
// an absolute path (require() resolves relative paths against this module's
// own location, not the caller's cwd).
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
    const require = createRequire(import.meta.url);
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
// and `configPath` (if given) must be absolute paths.
export function resolveTheme(opts: { rootDir: string | null; configPath?: string | null }): ResolvedTheme {
  const explicitPath = opts.configPath ?? null;
  const configPath = explicitPath ?? (opts.rootDir ? findTailwindConfig(opts.rootDir) : null);

  if (!configPath) {
    return { palette: defaultPalette, spacing: spacingScale };
  }

  const custom = loadCustomTheme(configPath);
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
