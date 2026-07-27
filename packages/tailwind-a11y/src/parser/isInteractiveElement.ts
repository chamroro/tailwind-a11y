import * as t from "@babel/types";

const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea"]);

export function isInteractiveElement(opening: t.JSXOpeningElement): boolean {
  const tagName = t.isJSXIdentifier(opening.name) ? opening.name.name : null;
  if (tagName !== null && INTERACTIVE_TAGS.has(tagName)) return true;
  return opening.attributes.some((a) => t.isJSXAttribute(a) && a.name.name === "onClick");
}
