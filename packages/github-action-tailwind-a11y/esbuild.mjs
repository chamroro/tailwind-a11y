import { build } from "esbuild";

// The bundle is COMMITTED to git (GitHub runs a JS action straight from the
// repo tree with no npm install, so every dependency -- the engine included --
// must live inside this one file). minify/sourcemap are off so rebuilds are
// reproducible byte-for-byte given the same esbuild version (pinned via the
// root lockfile + npm ci in CI) and diffs stay line-structured.
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "dist/index.js",
  platform: "node",
  format: "cjs",
  // The action.yml runtime is node24; node20 output syntax is free insurance.
  target: "node20",
  minify: false,
  sourcemap: false,
  logLevel: "info",
});
