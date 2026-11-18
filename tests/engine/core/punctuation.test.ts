import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage", "render-check"]);
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".css", ".html", ".md", ".json", ".txt"]);

// Characters with a direct ASCII equivalent, written as escapes so this file passes its own check. Characters
// without one (such as the middle dot, the ideographic full stop and comma, or corner brackets) are allowed.
const REPLACEMENTS: [RegExp, string][] = [
  [/[\u2018\u2019\u201a\u201b\u2032]/, "'"],
  [/[\u201c\u201d\u201e\u201f\u2033]/, '"'],
  [/[\u2010-\u2015\u2212]/, "-"],
  [/\u2026/, "..."],
  [/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/, "a plain space"],
  // Full-width forms of ASCII, e.g. the full-width comma, colon and parentheses.
  [/[\uff01-\uff5e]/, "the ASCII character"],
];

function textFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : textFiles(path);
    }
    return TEXT_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

describe("punctuation", () => {
  it("uses ASCII wherever an ASCII equivalent exists", () => {
    const files = textFiles(ROOT);
    expect(files.length).toBeGreaterThan(50);
    const problems: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const char of line) {
            const match = REPLACEMENTS.find(([pattern]) => pattern.test(char));
            if (match) {
              const code = "U+" + char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
              problems.push(`${relative(ROOT, file)}:${index + 1}: ${code} "${char}", use ${match[1]}`);
            }
          }
        });
    }
    expect(problems).toEqual([]);
  });
});
