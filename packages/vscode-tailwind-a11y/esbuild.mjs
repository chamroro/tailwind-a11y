import { build, context } from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  // VS Code 1.90's extension host runs on a recent Node via Electron, but
  // node18 is free insurance and the output difference is negligible.
  target: "node18",
  // Provided by the extension host at runtime; bundling it would break it.
  external: ["vscode"],
  minify: production,
  sourcemap: !production,
  logLevel: "info",
};

if (watch) {
  await (await context(options)).watch();
} else {
  await build(options);
}
