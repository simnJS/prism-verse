import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { analyze, ROOT, UPDATE } from "./helpers.ts";

const CASES: [string, string, string, string[]?][] = [
  ["P001", "unexpected character", "model A {\n  X Int $\n}\n"],
  ["P002", "missing type", "model A {\n  X\n}\n"],
  ["P003", "unterminated string", 'model A {\n  X String = "abc\n}\n'],
  ["P004", "unknown block", "table A {\n}\n"],
  ["P005", "unknown setting", 'generator {\n  prefx = "save"\n}\n'],
  ["P006", "invalid kind", 'datasource {\n  kind = "cloud"\n}\n'],
  ["P010", "duplicate declaration", "model A {\n  X Int\n}\n\ntype A {\n  Y Int\n}\n"],
  ["P011", "duplicate field", "model A {\n  X Int\n  X Float\n}\n"],
  ["P012", "unknown type", "model A {\n  Mines PlacedMines[]\n}\n\ntype PlacedMine {\n  Id Int\n}\n"],
  ["P013", "unknown attribute", "model A {\n  X Int @mni(0)\n}\n"],
  ["P014", "attribute on the wrong type", "model A {\n  Name String @min(0)\n}\n"],
  ["P015", "invalid argument", 'model A {\n  Items Int[] @maxItems("ten")\n}\n'],
  ["P016", "attribute given twice", "model A {\n  X Int @min(0) @min(1)\n}\n"],
  ["P017", "default of the wrong type", 'model A {\n  X Int = "zero"\n}\n'],
  ["P018", "conflicting attributes", 'model A {\n  X Int @transient @map("Y")\n}\n'],
  ["P019", "two fields saved under one name", 'model A {\n  X Int\n  Y Int @map("X")\n}\n'],
  ["P020", "migrations without a version field", "model A {\n  X Int\n\n  @@migrate(2, Upgrade)\n}\n"],
  ["P021", "lastSeen on an Int", "model A {\n  Seen Int @lastSeen\n}\n"],
  ["P022", "id on a Float", "type T {\n  Id Float @id\n}\n"],
  ["P023", "counter on a list without id", "model A {\n  Items T[]\n  Next Int @counter(Items.Id)\n}\n\ntype T {\n  Id Int\n}\n"],
  ["P024", "migration step 1", "model A {\n  Version Int = 1 @version\n\n  @@migrate(1, Upgrade)\n}\n"],
  ["P025", "five persistent stores", "model A {\n  X Int\n}\nmodel B {\n  X Int\n}\nmodel C {\n  X Int\n}\nmodel D {\n  X Int\n}\nmodel E {\n  X Int\n}\n"],
  ["P026", "type containing itself", "type Node {\n  Child Node\n}\n"],
  ["P027", "enum value listed twice", "enum Mode { Easy Easy }\n"],
  ["P028", "field clashing with a generated member", "model A {\n  Changed Int\n}\n"],
  ["P029", "nested list", "model A {\n  Grid Int[][]\n}\n"],
  ["P030", "model used as a field type", "model A {\n  X Int\n}\n\nmodel B {\n  Inner A\n}\n"],
  ["P031", "min greater than max", "model A {\n  X Int @min(5) @max(1)\n}\n"],
  ["P032", "@valid fallback of the wrong type", 'model A {\n  Ores Int[] @valid(IsKnownOre, "none")\n}\n'],
  ["P033", "field named like a project module", "model A {\n  Pets Int[] @maxItems(10)\n}\n", ["Pets", "Shop"]],
  ["P040", "record above 256 KB", "model A {\n  Drops Int[] @maxItems(20000)\n}\n"],
  ["P041", "list without @maxItems", "model A {\n  Mines Int[]\n}\n"],
];

test("every documented schema error has a case", () => {
  const documented = [...readFileSync(join(ROOT, "docs/errors.md"), "utf8").matchAll(/^\| (P0\d\d) \|/gm)].map((m) => m[1]);
  assert.deepEqual(documented, CASES.map((c) => c[0]));
});

test("error messages match the snapshot", () => {
  const blocks: string[] = [];
  for (const [code, name, text, modules] of CASES) {
    const result = analyze(text, "save.prism", modules);
    assert.ok(result.all.includes(code), `${code} (${name}) not raised; got ${result.all.join(", ") || "nothing"}`);
    blocks.push(`## ${code} ${name}\n\n${result.rendered}\n`);
  }
  const path = join(ROOT, "test/snapshots/errors.txt");
  const actual = blocks.join("\n");
  if (UPDATE || !existsSync(path)) writeFileSync(path, actual);
  assert.equal(actual, readFileSync(path, "utf8"));
});
