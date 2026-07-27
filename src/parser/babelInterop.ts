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
export const traverse = (
  typeof _traverse === "function" ? _traverse : (_traverse as any).default
) as unknown as TraverseFn;

export function parseJSX(code: string, filePath: string): t.File | null {
  try {
    return parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });
  } catch {
    console.warn(`tailwind-a11y: skipping unparsable file ${filePath}`);
    return null;
  }
}

export function getStaticClassName(attributes: t.JSXOpeningElement["attributes"]): string | null {
  const attr = attributes.find(
    (a): a is t.JSXAttribute => t.isJSXAttribute(a) && a.name.name === "className"
  );
  if (!attr || !attr.value) return null;
  if (t.isStringLiteral(attr.value)) return attr.value.value;
  return null; // JSXExpressionContainer (ternary, template literal, clsx()...) — skip silently
}
