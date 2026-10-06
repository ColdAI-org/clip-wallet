/**
 * The API reference's module descriptions come from each published entry file's header comment. TypeDoc only treats
 * that comment as the module's when it carries `@module`; without it the header is either dropped or copied onto the
 * declarations of the first export statement. And a word starting with `@` inside a comment is read as a block tag.
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publishedEntries } from "../scripts/typedoc.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const entries = publishedEntries(root) as { spec: string; file: string }[];

/** A header that documents the file's one declaration rather than the module. */
const DECLARATION_HEADERS = new Set(["packages/security/src/hide.ts"]);

describe("TypeDoc entry files", () => {
  it("every published export is found", () => {
    expect(entries.length).toBeGreaterThan(90);
  });

  it("a module header comment carries @module", () => {
    const missing: string[] = [];
    for (const e of entries) {
      const rel = relative(root, e.file);
      const header = /^\s*\/\*\*([\s\S]*?)\*\//.exec(readFileSync(e.file, "utf8"))?.[1];
      if (!header || DECLARATION_HEADERS.has(rel)) continue;
      if (!/^\s*\*\s*@module\s*$/m.test(header)) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });

  it("no Vue interpolation in a header outside a code block (VitePress compiles page text as a Vue template)", () => {
    const bad: string[] = [];
    for (const e of entries) {
      const header = /^\s*\/\*\*([\s\S]*?)\*\//.exec(readFileSync(e.file, "utf8"))?.[1] ?? "";
      const prose = header.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
      if (/\{\{|\}\}/.test(prose)) bad.push(relative(root, e.file));
    }
    expect(bad).toEqual([]);
  });

  it("no stray block tags in a header (a package name outside a code span reads as a tag)", () => {
    const stray: string[] = [];
    for (const e of entries) {
      const header = /^\s*\/\*\*([\s\S]*?)\*\//.exec(readFileSync(e.file, "utf8"))?.[1] ?? "";
      for (const line of header.split("\n")) {
        const text = line.replace(/^\s*\*\s?/, "").replace(/`[^`]*`/g, "").replace(/"[^"]*"/g, "");
        // TypeDoc's lexer reads "@word" followed by whitespace or the line end as a block tag ("@scope/name" is text).
        for (const m of text.matchAll(/(^|\s)@([a-z][\w-]*)(?=\s|$)/gi)) {
          if (m[2] === "module") continue;
          stray.push(`${relative(root, e.file)}: ${line.trim()}`);
        }
      }
    }
    expect(stray).toEqual([]);
  });
});
