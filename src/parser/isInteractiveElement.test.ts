import { describe, expect, it } from "vitest";
import { parse } from "@babel/parser";
import { isInteractiveElement } from "./isInteractiveElement.js";
import { traverse } from "./babelInterop.js";
import type * as t from "@babel/types";

function firstOpeningElement(code: string): t.JSXOpeningElement {
  const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
  let opening: t.JSXOpeningElement | undefined;
  traverse(ast, {
    JSXElement(path) {
      opening ??= path.node.openingElement;
    },
  });
  if (!opening) throw new Error("no JSX element found in fixture");
  return opening;
}

describe("isInteractiveElement", () => {
  it("treats <button> as interactive", () => {
    expect(isInteractiveElement(firstOpeningElement(`<button>x</button>;`))).toBe(true);
  });

  it("treats a capitalized custom component with no onClick as not interactive", () => {
    expect(isInteractiveElement(firstOpeningElement(`<Button>x</Button>;`))).toBe(false);
  });

  it("treats a div with onClick as interactive", () => {
    expect(isInteractiveElement(firstOpeningElement(`<div onClick={fn}>x</div>;`))).toBe(true);
  });

  it("treats a plain div as not interactive", () => {
    expect(isInteractiveElement(firstOpeningElement(`<div>x</div>;`))).toBe(false);
  });
});
