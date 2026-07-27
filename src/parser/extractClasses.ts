import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import type { NodePath } from "@babel/traverse";
import * as t from "@babel/types";

// @types/babel__traverse's default-export type doesn't line up with how
// NodeNext resolves the CJS default import here (it types as the whole
// module namespace, not the callable) — and at runtime the callable
// sometimes ends up on `.default` instead of the import itself. Define the
// one signature we actually use and resolve+cast to it directly rather than
// fighting the upstream type declarations.
type TraverseFn = (ast: t.File, visitor: { JSXElement?: (path: NodePath<t.JSXElement>) => void }) => void;
const traverse = (
  typeof _traverse === "function" ? _traverse : (_traverse as any).default
) as unknown as TraverseFn;

export interface ContrastCheck {
  file: string;
  line: number;
  textColorClass: string;
  bgColorClass: string;
  bgSource: "self" | "parent";
}

// Positive shape filter for "does this look like a color utility", not a
// blocklist — Tailwind heavily overloads the text-*/bg-* prefix (text-lg,
// bg-cover, bg-gradient-to-r, ...) and an exclude-list would be fragile
// across versions.
const COLOR_TOKEN = /^\[(#[0-9a-fA-F]{3,8})\]$|^[a-z]+-\d{2,3}(\/\d{1,3})?$|^(white|black|transparent|current|inherit)$/;

// opacity-{N} (e.g. bg-opacity-50, text-opacity-50) matches the same
// "word-number" shape as a color token but isn't one — without this
// exclusion it can silently overwrite a real color match via the
// last-token-wins rule below, making a real violation vanish (a false
// negative, the worst failure mode for a linter).
const NON_COLOR_SCALE_NAMES = new Set(["opacity"]);

function getStaticClassName(attributes: t.JSXOpeningElement["attributes"]): string | null {
  const attr = attributes.find(
    (a): a is t.JSXAttribute => t.isJSXAttribute(a) && a.name.name === "className"
  );
  if (!attr || !attr.value) return null;
  if (t.isStringLiteral(attr.value)) return attr.value.value;
  return null; // JSXExpressionContainer (ternary, template literal, clsx()...) — skip silently
}

function lastColorToken(className: string, prefix: "text" | "bg"): string | null {
  let found: string | null = null;
  for (const raw of className.split(/\s+/).filter(Boolean)) {
    const base = raw.slice(raw.lastIndexOf(":") + 1); // strip hover:/dark:/md: variants
    if (!base.startsWith(`${prefix}-`)) continue;
    const rest = base.slice(prefix.length + 1);
    if (!COLOR_TOKEN.test(rest)) continue;
    const scaleName = /^([a-z]+)-\d/.exec(rest)?.[1];
    if (scaleName && NON_COLOR_SCALE_NAMES.has(scaleName)) continue;
    found = base;
  }
  return found;
}

export function extractChecks(code: string, filePath: string): ContrastCheck[] {
  let ast;
  try {
    ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });
  } catch {
    console.warn(`tailwind-contrast-guard: skipping unparsable file ${filePath}`);
    return [];
  }

  const checks: ContrastCheck[] = [];

  traverse(ast, {
    JSXElement(path) {
      const className = getStaticClassName(path.node.openingElement.attributes);
      if (!className) return;

      const textClass = lastColorToken(className, "text");
      if (!textClass) return;

      const line = path.node.openingElement.loc?.start.line ?? 0;

      const ownBg = lastColorToken(className, "bg");
      if (ownBg) {
        checks.push({ file: filePath, line, textColorClass: textClass, bgColorClass: ownBg, bgSource: "self" });
        return;
      }

      // Only the immediate JSX parent is considered — no deeper ancestor
      // walk and no cross-component resolution (see CLAUDE.md scope).
      const parentNode = path.parentPath?.node;
      if (parentNode && t.isJSXElement(parentNode)) {
        const parentClassName = getStaticClassName(parentNode.openingElement.attributes);
        const parentBg = parentClassName ? lastColorToken(parentClassName, "bg") : null;
        if (parentBg) {
          checks.push({ file: filePath, line, textColorClass: textClass, bgColorClass: parentBg, bgSource: "parent" });
        }
      }
    },
  });

  return checks;
}
