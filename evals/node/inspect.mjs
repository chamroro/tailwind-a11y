// Scores one TSX source and measures how it was written, in a single pass.
//
// stdin : {"code": "<tsx source>", "file": "snippet.tsx"}
// stdout: exactly one JSON line (everything else goes to stderr)
//
// Two independent things are computed:
//  * the engine's verdict (analyzeSource, the same function the MCP server
//    wraps, called directly so the result is not cut at the server's
//    200-violation response cap), at AA and at strict;
//  * "bypass" measures taken straight from the syntax tree, with no help from
//    the engine, because the engine is silent about several ways of avoiding it
//    (inline style, arbitrary values, classNames it cannot read) and an agent
//    that learns the engine's blind spots would otherwise look cleaner.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSource } from "tailwind-a11y";
import { parse } from "@babel/parser";

// The engine's `exports` map does not expose ./package.json, so the version is
// read from the package directory found through its public entry point. This
// throws rather than returning null: a run whose engine version cannot be
// recorded must not be scored, since the version is part of what makes the
// result reproducible.
function engineVersion() {
  const entry = fileURLToPath(import.meta.resolve("tailwind-a11y")); // .../dist/index.js
  const pkg = JSON.parse(readFileSync(join(dirname(entry), "..", "package.json"), "utf8"));
  if (pkg.name !== "tailwind-a11y" || typeof pkg.version !== "string") {
    throw new Error(`unexpected package.json next to ${entry}`);
  }
  return pkg.version;
}

// One key per distinct mistake, so the same `text-gray-400 on bg-white` pair
// repeated on six elements counts once: fixing it is one edit, not six.
function uniqueKey(v) {
  switch (v.type) {
    case "contrast":
      return `contrast|${v.textClass}|${v.bgClass}`;
    case "touch-target":
      return `touch-target|${v.tagName}|${v.widthClass}|${v.heightClass}`;
    case "focus-indicator":
      return `focus-indicator|${v.removalClass}`;
    case "focus-contrast":
      return `focus-contrast|${v.indicatorClass}|${v.bgClass}`;
    case "reduced-motion":
      return `reduced-motion|${v.motionClass}`;
    default:
      return `${v.type}|?`;
  }
}

function runEngine(code, file, strict) {
  try {
    const r = analyzeSource(code, file, { strict, includeSkips: true });
    return {
      error: null,
      parsed: r.parsed,
      violations: r.violations.map((v) => ({ type: v.type, line: v.line, key: uniqueKey(v) })),
      skips: r.skips.map((s) => ({ line: s.line, reason: s.reason })),
    };
  } catch (err) {
    return { error: String(err && err.message ? err.message : err), parsed: false, violations: [], skips: [] };
  }
}

function tagName(name) {
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXNamespacedName") return `${name.namespace.name}:${name.name.name}`;
  return `${tagName(name.object)}.${name.property.name}`;
}

// A className that is a plain string literal is the only kind the engine reads.
function classNameKind(attr) {
  const v = attr.value;
  if (!v) return "none";
  if (v.type === "StringLiteral") return "static";
  return "dynamic";
}

function inspect(code) {
  let ast;
  try {
    ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });
  } catch (err) {
    return { parsed: false, error: String(err.message || err) };
  }

  const m = {
    parsed: true,
    elements: 0,
    style_attrs: 0,
    dynamic_classnames: 0,
    static_classnames: 0,
    arbitrary_value_classes: 0,
    custom_components: 0,
    tag_counts: Object.create(null),
    lines: code.split("\n").length,
  };

  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "JSXElement") {
      const opening = node.openingElement;
      const tag = tagName(opening.name);
      m.elements += 1;
      m.tag_counts[tag] = (m.tag_counts[tag] || 0) + 1;
      if (/^[A-Z]/.test(tag) || tag.includes(".")) m.custom_components += 1;
      for (const attr of opening.attributes) {
        if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier") continue;
        if (attr.name.name === "style") m.style_attrs += 1;
        if (attr.name.name === "className") {
          const kind = classNameKind(attr);
          if (kind === "dynamic") m.dynamic_classnames += 1;
          if (kind === "static") {
            m.static_classnames += 1;
            for (const token of attr.value.value.split(/\s+/)) {
              if (/\[[^\]]+\]/.test(token)) m.arbitrary_value_classes += 1;
            }
          }
        }
      }
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child.type === "string") visit(child);
    }
  };
  visit(ast.program);
  return m;
}

const input = JSON.parse(readFileSync(0, "utf8"));
const code = input.code ?? "";
const file = input.file ?? "snippet.tsx";

const out = {
  engine_version: engineVersion(),
  aa: runEngine(code, file, false),
  strict: runEngine(code, file, true),
  bypass: inspect(code),
};
process.stdout.write(JSON.stringify(out) + "\n");
