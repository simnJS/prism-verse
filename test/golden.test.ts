import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { generate, type GeneratedFile } from "../cli/generate.ts";
import { schemaHash } from "../cli/hash.ts";
import { analyze, ROOT, UPDATE } from "./helpers.ts";

function build(schemaPath: string, tweak: (text: string) => string = (t) => t, kind?: "player" | "memory"): GeneratedFile[] {
  const text = tweak(readFileSync(join(ROOT, schemaPath), "utf8"));
  const { schema, codes } = analyze(text);
  assert.deepEqual(codes, [], `${schemaPath} has errors`);
  if (kind) schema.settings.kind = kind;
  return generate(schema, { lib: "Prism", schemaName: "save.prism", schemaHash: schemaHash(text) });
}

function compare(files: GeneratedFile[], dir: string): void {
  for (const f of files) {
    const path = join(ROOT, dir, f.name);
    if (UPDATE || !existsSync(path)) {
      mkdirSync(join(ROOT, dir), { recursive: true });
      writeFileSync(path, f.text);
    }
    assert.equal(f.text, readFileSync(path, "utf8"), `${dir}/${f.name} differs from the generated output`);
  }
}

test("the examples hold the current generated output", () => {
  compare(build("examples/quickstart/save.prism", undefined, "memory"), "examples/quickstart");
  compare(build("examples/sellthings/save.prism"), "examples/sellthings");
});

test("golden: the coverage schema (every feature, compiled in UEFN)", () => {
  compare(build("test/fixtures/coverage/save.prism"), "test/fixtures/coverage");
});

test("golden: quickstart in player mode", () => {
  compare(build("examples/quickstart/save.prism"), "test/golden/quickstart_player");
});

test("golden: explicit copies instead of constructor copies", () => {
  compare(build("examples/sellthings/save.prism", (t) => t.replace('prefix = "demo_save"', 'prefix = "demo_save"\n  copy   = "explicit"')), "test/golden/sellthings_explicit");
});

test("generation is deterministic and carries no date", () => {
  const a = build("examples/sellthings/save.prism");
  const b = build("examples/sellthings/save.prism");
  assert.deepEqual(a, b);
  for (const f of a) assert.doesNotMatch(f.text, /\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}/);
});
