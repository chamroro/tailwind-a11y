import * as t from "@babel/types";
import { getStaticClassName, parseJSX, traverse } from "./babelInterop.js";
import { isInteractiveElement } from "./isInteractiveElement.js";
import { lastColorToken } from "./extractClasses.js";

export interface FocusIndicatorCheck {
  file: string;
  line: number;
  tagName: string;
  focusClasses: string[];
  // Same-element-or-immediate-parent bg-* resolution, reusing exactly the
  // model extractClasses.ts's extractChecks already uses for the text-
  // contrast check. checkFocusIndicators (the 2.4.7 removal check) never
  // reads these, so they're optional rather than forcing every existing
  // test fixture in checkFocusIndicator.test.ts to grow two unused fields --
  // only checkFocusContrast (1.4.11/2.4.13) reads them, and treats a
  // missing/null value as "skip" (no background to compare against), not a
  // guess.
  bgClass?: string | null;
  bgSource?: "self" | "parent" | null;
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

      const ownBg = lastColorToken(className, "bg");
      let bgClass: string | null = ownBg;
      let bgSource: "self" | "parent" | null = ownBg ? "self" : null;

      if (!bgClass) {
        // Only the immediate JSX parent, same limit as extractClasses.ts's
        // own contrast resolution — no deeper ancestor walk, no
        // cross-component resolution.
        const parentNode = path.parentPath?.node;
        if (parentNode && t.isJSXElement(parentNode)) {
          const parentClassName = getStaticClassName(parentNode.openingElement.attributes);
          const parentBg = parentClassName ? lastColorToken(parentClassName, "bg") : null;
          if (parentBg) {
            bgClass = parentBg;
            bgSource = "parent";
          }
        }
      }

      checks.push({
        file: filePath,
        line: opening.loc?.start.line ?? 0,
        tagName: t.isJSXIdentifier(opening.name) ? opening.name.name : "onClick-element",
        focusClasses,
        bgClass,
        bgSource,
      });
    },
  });

  return checks;
}
