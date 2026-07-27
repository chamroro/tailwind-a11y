import * as t from "@babel/types";
import { getStaticClassName, parseJSX, traverse } from "./babelInterop.js";
import { isInteractiveElement } from "./isInteractiveElement.js";

export interface FocusIndicatorCheck {
  file: string;
  line: number;
  tagName: string;
  focusClasses: string[];
}

function focusScopedClasses(className: string): string[] {
  return className
    .split(/\s+/)
    .filter(Boolean)
    .filter((raw) => {
      const segments = raw.split(":");
      const variant = segments[segments.length - 2]; // the variant immediately before the utility
      return variant === "focus" || variant === "focus-visible";
    });
}

export function extractFocusIndicatorChecks(code: string, filePath: string): FocusIndicatorCheck[] {
  const ast = parseJSX(code, filePath);
  if (!ast) return [];

  const checks: FocusIndicatorCheck[] = [];

  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      if (!isInteractiveElement(opening)) return;

      const className = getStaticClassName(opening.attributes);
      if (!className) return;

      const focusClasses = focusScopedClasses(className);
      if (focusClasses.length === 0) return; // nothing under focus:/focus-visible: — not a candidate

      checks.push({
        file: filePath,
        line: opening.loc?.start.line ?? 0,
        tagName: t.isJSXIdentifier(opening.name) ? opening.name.name : "onClick-element",
        focusClasses,
      });
    },
  });

  return checks;
}
