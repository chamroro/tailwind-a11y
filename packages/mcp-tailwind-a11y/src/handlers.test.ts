import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_CALL_BYTES, MAX_PATHS, MAX_REPORTED, MAX_SOURCE_BYTES, UserError, checkCode, checkFiles } from "./handlers.js";

const LOW_CONTRAST = `const C = () => <p className="text-gray-400 bg-white">x</p>;`;

let base: string; // holds both the project and a sibling directory outside it
let root: string;
let outside: string;
const ctx = () => ({ root });

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "mcp-a11y-")));
  root = join(base, "project");
  outside = join(base, "project-other"); // shares the root's name as a prefix on purpose
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "..odd"), { recursive: true });
  mkdirSync(outside, { recursive: true });

  writeFileSync(join(root, "src", "Card.tsx"), LOW_CONTRAST);
  writeFileSync(join(root, "src", "Clean.tsx"), `const C = () => <p className="text-gray-900 bg-white">ok</p>;`);
  writeFileSync(join(root, "src", "Broken.tsx"), "const x = {{{ not valid jsx");
  writeFileSync(join(root, "src", "notes.md"), LOW_CONTRAST);
  writeFileSync(join(root, "..odd", "Ok.tsx"), LOW_CONTRAST);
  writeFileSync(join(root, "src", "Big.tsx"), "x".repeat(MAX_SOURCE_BYTES + 1));

  // A real file outside the root, reachable by every kind of escape.
  writeFileSync(join(outside, "Secret.tsx"), LOW_CONTRAST);
  symlinkSync(join(outside, "Secret.tsx"), join(root, "src", "link.tsx"));
  symlinkSync(outside, join(root, "src", "linkdir"));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("checkCode", () => {
  it("reports a violation with its WCAG criterion, message and fix suggestion", () => {
    const result = checkCode({ code: LOW_CONTRAST }, ctx());
    expect(result.summary).toEqual({ parsed: true, violations: 1, skipped: 0, truncated: false });
    const [v] = result.violations;
    expect(v).toMatchObject({ line: 1, wcag: "1.4.3", type: "contrast" });
    expect(v.message).toContain("try text-gray-500");
    expect(v.details).toMatchObject({ suggestion: "text-gray-500", textClass: "text-gray-400" });
  });

  it("labels results with filePath, defaulting to snippet.tsx", () => {
    expect(checkCode({ code: LOW_CONTRAST }, ctx()).violations[0].details.file).toBe("snippet.tsx");
    expect(checkCode({ code: LOW_CONTRAST, filePath: "src/Card.tsx" }, ctx()).violations[0].details.file).toBe(
      "src/Card.tsx"
    );
  });

  it("returns nothing for clean code, with parsed:true", () => {
    const result = checkCode({ code: `const C = () => <p className="text-gray-900 bg-white">ok</p>;` }, ctx());
    expect(result).toEqual({
      summary: { parsed: true, violations: 0, skipped: 0, truncated: false },
      violations: [],
      skipped: [],
      warnings: [],
    });
  });

  it("gates the AAA tier behind strict", () => {
    const code = `const C = () => <button className="w-10 h-10">x</button>;`;
    expect(checkCode({ code }, ctx()).violations).toEqual([]);
    expect(checkCode({ code, strict: true }, ctx()).violations[0]).toMatchObject({ wcag: "2.5.5" });
  });

  it("reports elements it could not check instead of staying silent", () => {
    const code = `const C = () => <p className={cn("text-gray-400", on && "p-2")}>x</p>;`;
    const result = checkCode({ code }, ctx());
    expect(result.violations).toEqual([]);
    expect(result.summary.skipped).toBe(1);
    expect(result.skipped[0].reason).toContain("cn(...) call");
  });

  it("says unparsable code was not checked, rather than returning a clean result", () => {
    const result = checkCode({ code: "const x = {{{ not valid jsx" }, ctx());
    expect(result.summary).toEqual({ parsed: false, violations: 0, skipped: 0, truncated: false });
    expect(result.warnings.join(" ")).toContain("nothing was checked");
    expect(result.warnings.join(" ")).toContain("not a pass");
  });

  it("refuses code over the size limit", () => {
    expect(() => checkCode({ code: "x".repeat(MAX_SOURCE_BYTES + 1) }, ctx())).toThrow(UserError);
  });

  describe("theme", () => {
    it("resolves a custom color from the project's Tailwind config", () => {
      writeFileSync(join(root, "tailwind.config.cjs"), `module.exports = { theme: { extend: { colors: { brand: { 500: "#9ca3af" } } } } };`);
      try {
        const code = `const C = () => <p className="text-brand-500 bg-white">x</p>;`;
        expect(checkCode({ code }, ctx()).violations[0]).toMatchObject({ type: "contrast" });
      } finally {
        rmSync(join(root, "tailwind.config.cjs"));
      }
    });

    it("accepts a configPath inside the root", () => {
      writeFileSync(join(root, "theme.cjs"), `module.exports = { theme: { extend: { colors: { brand: { 500: "#9ca3af" } } } } };`);
      try {
        const code = `const C = () => <p className="text-brand-500 bg-white">x</p>;`;
        expect(checkCode({ code, configPath: "theme.cjs" }, ctx()).violations).toHaveLength(1);
      } finally {
        rmSync(join(root, "theme.cjs"));
      }
    });

    it("refuses a configPath outside the root, so a client cannot make the server execute it", () => {
      writeFileSync(join(outside, "evil.cjs"), `require("node:fs").writeFileSync(${JSON.stringify(join(base, "pwned"))}, "x"); module.exports = {};`);
      expect(() => checkCode({ code: LOW_CONTRAST, configPath: "../project-other/evil.cjs" }, ctx())).toThrow(/outside the project root/);
      expect(() => checkCode({ code: LOW_CONTRAST, configPath: join(outside, "evil.cjs") }, ctx())).toThrow(/outside the project root/);
      expect(() => checkFiles({ paths: ["src/Card.tsx"], configPath: "../project-other/evil.cjs" }, ctx())).toThrow(/outside the project root/);
      expect(() => realpathSync(join(base, "pwned"))).toThrow(); // never executed
    });

    it("will not run an auto-detected config that is a symlink to a file outside the root", () => {
      const marker = join(base, "pwned-by-autodetect");
      writeFileSync(join(outside, "linked.cjs"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x"); module.exports = {};`);
      symlinkSync(join(outside, "linked.cjs"), join(root, "tailwind.config.cjs"));
      try {
        const result = checkCode({ code: LOW_CONTRAST }, ctx());
        expect(() => realpathSync(marker)).toThrow(); // never executed
        expect(result.warnings.join(" ")).toContain("Ignored a Tailwind config that resolves to outside the project root");
        expect(result.violations).toHaveLength(1); // default theme still applies
      } finally {
        rmSync(join(root, "tailwind.config.cjs"));
      }
    });

    it("still uses an auto-detected config that is a symlink to a file inside the root", () => {
      writeFileSync(join(root, "real-theme.cjs"), `module.exports = { theme: { extend: { colors: { brand: { 500: "#9ca3af" } } } } };`);
      symlinkSync(join(root, "real-theme.cjs"), join(root, "tailwind.config.cjs"));
      try {
        const code = `const C = () => <p className="text-brand-500 bg-white">x</p>;`;
        expect(checkCode({ code }, ctx()).violations).toHaveLength(1);
      } finally {
        rmSync(join(root, "tailwind.config.cjs"));
        rmSync(join(root, "real-theme.cjs"));
      }
    });

    it("refuses an upper-case .CSS extension, which the engine would otherwise execute as JavaScript", () => {
      writeFileSync(join(root, "theme.CSS"), "module.exports = {};");
      try {
        expect(() => checkCode({ code: LOW_CONTRAST, configPath: "theme.CSS" }, ctx())).toThrow(/must be a \.js/);
      } finally {
        rmSync(join(root, "theme.CSS"));
      }
    });

    it("judges a config symlink by what it resolves to, and rejects one whose target is not a config type", () => {
      writeFileSync(join(root, "target.txt"), "x");
      symlinkSync(join(root, "target.txt"), join(root, "t.css"));
      try {
        // The link is named .css but resolves to a .txt file: refused on the resolved name.
        expect(() => checkCode({ code: LOW_CONTRAST, configPath: "t.css" }, ctx())).toThrow(/must be a \.js/);
      } finally {
        rmSync(join(root, "t.css"));
        rmSync(join(root, "target.txt"));
      }
    });

    it("refuses a configPath that is not a config file type", () => {
      expect(() => checkCode({ code: LOW_CONTRAST, configPath: "src/Card.tsx" }, ctx())).toThrow(/must be a \.js/);
    });

    it("warns when an explicit configPath cannot be loaded, and falls back to the default theme", () => {
      writeFileSync(join(root, "broken.cjs"), "throw new Error('boom');");
      try {
        const result = checkCode({ code: LOW_CONTRAST, configPath: "broken.cjs" }, ctx());
        expect(result.warnings.join(" ")).toContain("Could not load the Tailwind config /broken.cjs");
        expect(result.warnings.join(" ")).not.toContain(root); // a warning carries no absolute path
        expect(result.violations).toHaveLength(1);
      } finally {
        rmSync(join(root, "broken.cjs"));
      }
    });
  });
});

describe("response limits", () => {
  // Far more violations than a model can read, from one small file.
  const many = (n: number) =>
    `const C = () => (<div>${Array.from({ length: n }, () => `<p className="text-gray-400 bg-white">x</p>`).join("")}</div>);`;

  it("lists at most MAX_REPORTED violations but reports the true total and says it was cut", () => {
    const result = checkCode({ code: many(MAX_REPORTED + 50) }, ctx());
    expect(result.violations).toHaveLength(MAX_REPORTED);
    expect(result.summary).toMatchObject({ violations: MAX_REPORTED + 50, truncated: true });
    expect(result.warnings.join(" ")).toContain(`first ${MAX_REPORTED}`);
  });

  it("does not claim truncation when everything fit", () => {
    const result = checkCode({ code: many(3) }, ctx());
    expect(result.summary).toMatchObject({ violations: 3, truncated: false });
    expect(result.warnings).toEqual([]);
  });

  it("shares one violation budget across the files of a call rather than allowing MAX_REPORTED each", () => {
    for (const name of ["A", "B", "C"]) writeFileSync(join(root, "src", `Many${name}.tsx`), many(MAX_REPORTED - 20));
    try {
      const result = checkFiles({ paths: ["src/ManyA.tsx", "src/ManyB.tsx", "src/ManyC.tsx"] }, ctx());
      const listed = result.files.reduce((n, f) => n + f.violations.length, 0);
      expect(listed).toBe(MAX_REPORTED);
      expect(result.summary).toMatchObject({ violations: 3 * (MAX_REPORTED - 20), truncated: true });
      expect(result.files.map((f) => f.violationCount)).toEqual([MAX_REPORTED - 20, MAX_REPORTED - 20, MAX_REPORTED - 20]);
    } finally {
      for (const name of ["A", "B", "C"]) rmSync(join(root, "src", `Many${name}.tsx`));
    }
  });

  it("stops reading once a call has read MAX_CALL_BYTES, and says which files were left", () => {
    const bigButValid =
      `const C = () => <p className="text-gray-900 bg-white">x</p>;\n` + "// pad\n".repeat(Math.floor((MAX_SOURCE_BYTES - 100) / 7));
    const count = Math.ceil(MAX_CALL_BYTES / MAX_SOURCE_BYTES) + 1;
    const names = Array.from({ length: count }, (_, i) => `src/Big${i}.tsx`);
    for (const n of names) writeFileSync(join(root, n), bigButValid);
    try {
      const result = checkFiles({ paths: names }, ctx());
      expect(result.summary.checked).toBeLessThan(count);
      const refused = result.files.filter((f) => f.error?.includes("already read"));
      expect(refused.length).toBeGreaterThan(0);
      expect(refused.every((f) => f.parsed === false)).toBe(true);
    } finally {
      for (const n of names) rmSync(join(root, n));
    }
  });
});

describe("checkFiles", () => {
  it("reads files relative to the root and reports them by root-relative path", () => {
    const result = checkFiles({ paths: ["src/Card.tsx"] }, ctx());
    expect(result.summary).toEqual({ files: 1, checked: 1, unchecked: 0, violations: 1, skipped: 0, truncated: false });
    expect(result.files[0].file).toBe("/src/Card.tsx");
    expect(result.files[0].violations[0].details.suggestion).toBe("text-gray-500");
  });

  it("reports each file separately and keeps going past a bad one", () => {
    const result = checkFiles({ paths: ["src/Card.tsx", "src/missing.tsx", "src/Clean.tsx"] }, ctx());
    expect(result.files.map((f) => [f.file, Boolean(f.error)])).toEqual([
      ["/src/Card.tsx", false],
      ["src/missing.tsx", true],
      ["/src/Clean.tsx", false],
    ]);
    expect(result.summary).toMatchObject({ files: 3, checked: 2, violations: 1 });
  });

  it("marks an unparsable file as not parsed, says so, and counts it as unchecked", () => {
    const result = checkFiles({ paths: ["src/Broken.tsx", "src/Card.tsx"] }, ctx());
    expect(result.files[0]).toMatchObject({ parsed: false, violations: [] });
    expect(result.files[0].error).toMatch(/nothing was checked.*not a pass/);
    expect(result.summary).toMatchObject({ files: 2, checked: 1, unchecked: 1 });
  });

  it("gives checkFiles the strict flag", () => {
    writeFileSync(join(root, "src", "Forty.tsx"), `const C = () => <button className="w-10 h-10">x</button>;`);
    try {
      expect(checkFiles({ paths: ["src/Forty.tsx"] }, ctx()).summary.violations).toBe(0);
      const strict = checkFiles({ paths: ["src/Forty.tsx"], strict: true }, ctx());
      expect(strict.summary.violations).toBe(1);
      expect(strict.files[0].violations[0].wcag).toBe("2.5.5");
    } finally {
      rmSync(join(root, "src", "Forty.tsx"));
    }
  });

  it("applies a theme to files read from disk", () => {
    writeFileSync(join(root, "tailwind.config.cjs"), `module.exports = { theme: { extend: { colors: { brand: { 500: "#9ca3af" } } } } };`);
    writeFileSync(join(root, "src", "Brand.tsx"), `const C = () => <p className="text-brand-500 bg-white">x</p>;`);
    try {
      expect(checkFiles({ paths: ["src/Brand.tsx"] }, ctx()).summary.violations).toBe(1);
    } finally {
      rmSync(join(root, "tailwind.config.cjs"));
      rmSync(join(root, "src", "Brand.tsx"));
    }
  });

  it("does not put an absolute path in an error for a file it cannot read", () => {
    writeFileSync(join(root, "src", "Locked.tsx"), LOW_CONTRAST, { mode: 0o000 });
    try {
      const [file] = checkFiles({ paths: ["src/Locked.tsx"] }, ctx()).files;
      expect(file.error).toBeDefined();
      expect(file.error).not.toContain(root);
    } finally {
      rmSync(join(root, "src", "Locked.tsx"));
    }
  });

  it("counts nothing as checked when no file could be read", () => {
    const result = checkFiles({ paths: ["src/Broken.tsx", "src/missing.tsx"] }, ctx());
    expect(result.summary.checked).toBe(0);
  });

  describe("path guard", () => {
    const refused = (p: string) => checkFiles({ paths: [p] }, ctx()).files[0];

    it.each([
      ["a .. escape to a real file", "../project-other/Secret.tsx"],
      ["an absolute path to a real file", () => join(outside, "Secret.tsx")],
      ["a symlink to a real file outside", "src/link.tsx"],
      ["a path through a symlinked directory", "src/linkdir/Secret.tsx"],
    ])("refuses %s", (_label, p) => {
      const file = refused(typeof p === "function" ? p() : p);
      expect(file.error).toMatch(/outside the project root/);
      expect(file.violations).toEqual([]);
    });

    it("answers identically for an outside path whether or not the file exists, so it can't be used to probe the filesystem", () => {
      const existing = refused("../project-other/Secret.tsx").error;
      const missing = refused("../project-other/DoesNotExist.tsx").error;
      expect(existing).toMatch(/outside the project root/);
      expect(missing).toMatch(/outside the project root/);
      expect(missing).not.toMatch(/not found/);
      expect(refused(join(outside, "DoesNotExist.tsx")).error).toMatch(/outside the project root/);
    });

    it("does not treat a sibling directory sharing the root's name as a prefix as inside", () => {
      expect(refused("../project-other/Secret.tsx").error).toMatch(/outside the project root/);
    });

    it("still allows a directory literally named ..odd inside the root", () => {
      const file = refused("..odd/Ok.tsx");
      expect(file.error).toBeUndefined();
      expect(file.violations).toHaveLength(1);
    });

    it("refuses an unsupported extension", () => {
      expect(refused("src/notes.md").error).toMatch(/only \.jsx and \.tsx/);
    });

    it("refuses a file over the size limit", () => {
      expect(refused("src/Big.tsx").error).toMatch(/larger than/);
    });

    it("refuses a directory", () => {
      mkdirSync(join(root, "src", "dir.tsx"), { recursive: true });
      try {
        expect(refused("src/dir.tsx").error).toMatch(/not a file/);
      } finally {
        rmSync(join(root, "src", "dir.tsx"), { recursive: true });
      }
    });

    it(`refuses more than ${MAX_PATHS} paths in one call`, () => {
      const paths = Array.from({ length: MAX_PATHS + 1 }, () => "src/Card.tsx");
      expect(() => checkFiles({ paths }, ctx())).toThrow(UserError);
    });
  });
});
