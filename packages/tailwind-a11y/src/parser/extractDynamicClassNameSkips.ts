import * as t from "@babel/types";
import { dynamicClassNameKind, parseJSX, traverse } from "./babelInterop.js";

export interface DynamicClassNameSkip {
  file: string;
  line: number;
  reason: string;
}

// `Foo.Bar` / `svg:rect` aren't JSXIdentifiers; spelling them out keeps the
// message pointing at an element a person can find, not a generic "element".
function tagName(name: t.JSXOpeningElement["name"]): string {
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXNamespacedName(name)) return `${name.namespace.name}:${name.name.name}`;
  return `${tagName(name.object)}.${name.property.name}`;
}

// Every other extractor drops an element whose className isn't a plain string
// literal (`if (!className) return;`), so a cn()-heavy codebase can report
// "no issues" while most of its elements were never looked at. This pass
// surfaces those elements -- same "a skip is not a pass" principle as
// extractContrastSkips/extractTouchTargetSkips. It walks every JSXElement
// regardless of tag, matching the other extractors (components included).
export function extractDynamicClassNameSkips(code: string, filePath: string): DynamicClassNameSkip[] {
  const ast = parseJSX(code, filePath);
  if (!ast) return [];

  const skips: DynamicClassNameSkip[] = [];

  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      const kind = dynamicClassNameKind(opening.attributes);
      if (!kind) return;

      const tag = tagName(opening.name);
      skips.push({
        file: filePath,
        line: opening.loc?.start.line ?? 0,
        reason: `<${tag}> className is not a plain string literal (${kind}) — not statically resolved, so none of its classes were checked`,
      });
    },
  });

  return skips;
}
