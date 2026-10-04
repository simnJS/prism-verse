import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CODES } from "../cli/codes.ts";
import { ROOT } from "./helpers.ts";

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, ext) : path.endsWith(ext) ? [path] : [];
  });
}

function blocks(markdown: string, lang: string): string[] {
  return [...markdown.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g"))].map((m) => m[1]!);
}

const trimmed = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

function contains(haystack: string[], needle: string[]): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

const docs = [join(ROOT, "README.md"), ...files(join(ROOT, "docs"), ".md")];
const examples = files(join(ROOT, "examples"), ".verse").map((f) => trimmed(readFileSync(f, "utf8")));

test("every Verse snippet of the docs exists, word for word, in a compiled example", () => {
  for (const doc of docs) {
    for (const block of blocks(readFileSync(doc, "utf8"), "verse")) {
      const lines = trimmed(block);
      assert.ok(examples.some((e) => contains(e, lines)), `snippet of ${doc} is not in examples/:\n${block}`);
    }
  }
});

test("the README quickstart schema is examples/quickstart/save.prism", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const schema = readFileSync(join(ROOT, "examples/quickstart/save.prism"), "utf8");
  assert.ok(blocks(readme, "prisma").includes(schema), "the first schema of the quickstart must equal the example file");
});

test("the SellThings migration snippet uses the example schema", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const demo = readFileSync(join(ROOT, "examples/sellthings/save.prism"), "utf8");
  for (const line of ["@@migrate(2, MoneyToFloat)", '@map("Money")', '@map("Coins") @deprecated']) {
    assert.ok(readme.includes(line) && demo.includes(line), line);
  }
});

test("docs/errors.md lists exactly the codes of the catalog", () => {
  const documented = [...readFileSync(join(ROOT, "docs/errors.md"), "utf8").matchAll(/^\| (P\d{3}) \|/gm)].map((m) => m[1]);
  assert.deepEqual(documented, Object.keys(CODES));
});
