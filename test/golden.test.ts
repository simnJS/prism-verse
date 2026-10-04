import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { Reporter } from "../cli/diagnostics.ts";
import { generate, type GeneratedFile } from "../cli/generate.ts";
import { schemaHash } from "../cli/hash.ts";
import { parseSnapshot, type Snapshot } from "../cli/lock.ts";
import { assignCodes, parseNames, publishedCodes } from "../cli/naming.ts";
import type { Schema } from "../cli/schema.ts";
import { SourceFile } from "../cli/source.ts";
import { analyze, ROOT, UPDATE } from "./helpers.ts";

// Saved names as the CLI assigns them: published shapes, then names.json, both next to the schema.
function assignAsCli(schema: Schema, schemaPath: string): void {
  const dir = join(ROOT, dirname(schemaPath), "prism", basename(schemaPath, ".prism"));
  const files = existsSync(dir) ? readdirSync(dir).filter((n) => /^\d{4}\.json$/.test(n)).sort() : [];
  const shapes = files.map((n) => parseSnapshot(new SourceFile(n, readFileSync(join(dir, n), "utf8")), new Reporter())).filter((s): s is Snapshot => s !== undefined);
  const names = existsSync(join(dir, "names.json")) ? parseNames(readFileSync(join(dir, "names.json"), "utf8")) : undefined;
  schema.codes = assignCodes(schema, publishedCodes(shapes), names ?? new Map(), new Set());
}

function build(schemaPath: string, tweak: (text: string) => string = (t) => t, kind?: "player" | "memory"): GeneratedFile[] {
  const text = tweak(readFileSync(join(ROOT, schemaPath), "utf8"));
  const { schema, codes, rendered } = analyze(text);
  assert.deepEqual(codes, [], `${schemaPath} has errors:\n${rendered}`);
  if (kind) schema.settings.kind = kind;
  assignAsCli(schema, schemaPath);
  return generate(schema, { lib: "Prism", schemaName: basename(schemaPath), schemaHash: schemaHash(text) });
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
  for (const example of ["sellthings", "migration", "measure"]) compare(build(`examples/${example}/save.prism`), `examples/${example}`);
  for (const variant of ["names_long", "names_short"]) compare(build(`examples/measure/${variant}.prism`), "examples/measure");
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
