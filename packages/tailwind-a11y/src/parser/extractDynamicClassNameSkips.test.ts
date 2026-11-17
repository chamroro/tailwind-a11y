import { describe, expect, it } from "vitest";
import { extractDynamicClassNameSkips } from "./extractDynamicClassNameSkips.js";

function skipsFor(jsx: string) {
  return extractDynamicClassNameSkips(`const C = () => (${jsx});`, "fake.tsx");
}

describe("extractDynamicClassNameSkips", () => {
  it.each([
    ["cn(...) call", `<div className={cn("text-gray-400", x && "p-2")}>x</div>`],
    ["clsx(...) call", `<div className={clsx("text-gray-400")}>x</div>`],
    ["template literal", "<div className={`text-gray-400 ${x}`}>x</div>"],
    ["conditional expression", `<div className={x ? "a" : "b"}>x</div>`],
    ["logical expression", `<div className={x && "a"}>x</div>`],
    ["variable reference", `<div className={styles}>x</div>`],
    ["variable reference", `<div className={styles.card}>x</div>`],
  ])("reports a %s", (kind, jsx) => {
    const skips = skipsFor(jsx);
    expect(skips).toHaveLength(1);
    expect(skips[0].reason).toContain(kind);
    expect(skips[0].reason).toContain("<div>");
    expect(skips[0].reason).toContain("not statically resolved");
  });

  it("names a non-identifier callee generically instead of guessing", () => {
    const skips = skipsFor(`<div className={utils.cn("a")}>x</div>`);
    expect(skips[0].reason).toContain("function call");
  });

  it("reports a string literal wrapped in braces as an expression, not as 'dynamic' (it is not resolved today, but is not dynamic either)", () => {
    const skips = skipsFor(`<div className={"text-gray-400"}>x</div>`);
    expect(skips).toHaveLength(1);
    expect(skips[0].reason).toContain("(expression)");
    expect(skips[0].reason).not.toContain("dynamic");
  });

  it("does not report a plain string-literal className", () => {
    expect(skipsFor(`<div className="text-gray-400">x</div>`)).toEqual([]);
  });

  it("does not report an element with no className", () => {
    expect(skipsFor(`<div id="a">x</div>`)).toEqual([]);
  });

  it("does not report an element whose only attribute is a spread", () => {
    expect(skipsFor(`<div {...props}>x</div>`)).toEqual([]);
  });

  it.each(["null", "undefined"])("does not report className={%s} -- it carries no classes", (value) => {
    expect(skipsFor(`<div className={${value}}>x</div>`)).toEqual([]);
  });

  it("reports an element that has both a spread and a dynamic className exactly once", () => {
    expect(skipsFor(`<div {...props} className={cn("a")}>x</div>`)).toHaveLength(1);
  });

  it("reports each level of nested elements once", () => {
    const skips = skipsFor(`<div className={cn("a")}><p className={cn("b")}><b className={cn("c")}>x</b></p></div>`);
    expect(skips).toHaveLength(3);
  });

  it("reports an element inside a fragment", () => {
    const skips = skipsFor(`<><span className={"a"}>x</span></>`);
    expect(skips).toHaveLength(1);
    expect(skips[0].reason).toContain("<span>");
  });

  it.each([
    ["<Foo.Bar>", `<Foo.Bar className={cn("a")}>x</Foo.Bar>`],
    ["<Foo.Bar.Baz>", `<Foo.Bar.Baz className={cn("a")}>x</Foo.Bar.Baz>`],
    ["<svg:rect>", `<svg:rect className={cn("a")} />`],
  ])("spells out the tag name %s instead of a generic placeholder", (tag, jsx) => {
    const skips = skipsFor(jsx);
    expect(skips).toHaveLength(1);
    expect(skips[0].reason).toContain(tag);
    expect(skips[0].reason).not.toContain("<element>");
  });

  it("reports custom components too, matching the other extractors' tag-agnostic walk", () => {
    const skips = skipsFor(`<Card className={cn("p-2")}>x</Card>`);
    expect(skips).toHaveLength(1);
    expect(skips[0].reason).toContain("<Card>");
  });

  it("reports each dynamic element separately, with its own line", () => {
    const code = [
      "const C = () => (",
      "  <div>",
      '    <p className={cn("a")}>one</p>',
      '    <p className="static">two</p>',
      '    <p className={x ? "a" : "b"}>three</p>',
      "  </div>",
      ");",
    ].join("\n");
    const skips = extractDynamicClassNameSkips(code, "fake.tsx");
    expect(skips.map((s) => s.line)).toEqual([3, 5]);
  });

  it("returns an empty array for unparsable files instead of throwing", () => {
    expect(() => extractDynamicClassNameSkips("const x = {{{ not valid jsx", "broken.tsx")).not.toThrow();
    expect(extractDynamicClassNameSkips("const x = {{{ not valid jsx", "broken.tsx")).toEqual([]);
  });
});
