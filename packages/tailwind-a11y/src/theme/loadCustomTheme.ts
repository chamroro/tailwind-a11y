import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { defaultPalette } from "./defaultPalette.js";
import { spacingScale } from "./spacingScale.js";
import { parseColorScale, parseSpacingValue } from "./themeValueParsers.js";
import { parseThemeCss } from "./parseThemeCss.js";
import type { Palette } from "./defaultPalette.js";

// .mjs appended last (lowest priority) -- the newly-supported format behind
// the two established ones, same "most established first" ordering
// CSS_THEME_CANDIDATES below already uses for its own list.
const CONFIG_FILENAMES = ["tailwind.config.js", "tailwind.config.cjs", "tailwind.config.mjs"];

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

// Loads a Tailwind v3-style tailwind.config.js/.cjs/.mjs and extracts only
// `theme.extend.colors`/`theme.extend.spacing` -- v1 does not read a full
// `theme.colors`/`theme.spacing` replacement, or .ts configs. Tailwind v4's
// CSS-based `@theme` config is a separate format entirely, handled by
// loadThemeFromCssFile()/parseThemeCss() below, not by this function.
// `configPath` must be an absolute path (require() resolves relative paths
// against this module's own location, not the caller's cwd).
//
// .mjs works via plain require() -- verified this session that Node
// 20.19+/22.13+ can require() an ESM module synchronously, no import(), no
// async refactor. On an older Node this throws ERR_REQUIRE_ESM, already
// caught below and treated as "no config found," so this degrades exactly
// as gracefully as it did before .mjs was supported. Every adapter's actual
// runtime already clears the threshold: the GitHub Action runs on Node 24
// (action.yml), eslint-plugin-tailwind-a11y's own engines.node already
// excludes every version that lacks this, and the CLI's broad >=18 floor
// just falls back safely on anything older.
//
// .ts is a deliberate non-goal, not a "not yet": Node's native TypeScript
// type-stripping only activates when the *host* process is launched with
// --experimental-strip-types (verified this session -- a library can't
// turn this on for the user), so the only way to support .ts transparently
// would be promoting esbuild from a devDependency to a real runtime
// dependency of this package purely to transpile config files, a real
// native-binary weight increase. Also verified this session: a fresh
// `create-next-app --typescript --tailwind` no longer generates a JS/TS
// config file at all -- Tailwind v4 projects put theme customization in a
// CSS `@theme` block instead (see loadThemeFromCssFile() below), so .ts
// config support would only help a shrinking population of legacy
// v3-plus-TypeScript projects, not worth the dependency.
//
// Known limitation, not fixed: bustRequireCache() below does NOT work for
// a .mjs config. Node's synchronous require(esm) caches the module in its
// own internal ESM registry, not (only) in `require.cache` -- deleting the
// `require.cache` entry doesn't force a reload, confirmed with a real
// edit-and-reload test this session. CLI and GitHub Action are unaffected
// (fresh process per run either way); the VS Code extension's live-reload
// guarantee, which does work correctly for .js/.cjs/.css configs, does NOT
// extend to .mjs -- editing a .mjs config requires reloading the window.
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
    const loaded = require(resolved);
    // Node's require() of an ESM module returns the module namespace object
    // (`{ __esModule: true, default: <the actual export>, ...named exports
    // }`), not the export itself. Gated strictly on the .mjs extension --
    // caught in independent review: a structural check ("does it have a
    // `default` key") instead of this would silently misfire on a genuine
    // CJS config that happens to export its own top-level `default` key
    // (e.g. `module.exports = { default: "unrelated", theme: {...} }`),
    // discarding the real theme with no error. .mjs is the only path that
    // can ever produce this wrapped shape here: a `.js`/`.cjs` require()
    // either returns the CJS export as-is, or -- inside a "type": "module"
    // package -- throws ERR_REQUIRE_ESM before this line is ever reached
    // (already handled by the catch block below, and already tested).
    const config = resolved.endsWith(".mjs") && loaded && typeof loaded === "object" ? loaded.default : loaded;
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
