import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkAgainst } from "../cli/check.ts";
import { render, Reporter } from "../cli/diagnostics.ts";
import { importSchema } from "../cli/import.ts";
import { buildSnapshot, compareHistory } from "../cli/lock.ts";
import { SourceFile } from "../cli/source.ts";
import { scanVerse } from "../cli/verse_scan.ts";
import { analyze, ROOT } from "./helpers.ts";

const fixture = new SourceFile("save_format.verse", readFileSync(join(ROOT, "test/fixtures/sellthings/save_format.verse"), "utf8"));
const scan = scanVerse([fixture]);
const demoText = readFileSync(join(ROOT, "examples/sellthings/save.prism"), "utf8");

function errors(reporter: Reporter): string[] {
  return reporter.diagnostics.filter((d) => d.severity === "error").map(render);
}

test("the scanner reads the published classes, store and fields", () => {
  assert.deepEqual(scan.classes.map((c) => c.name), ["player_saved", "inventory_stack", "placed_mine", "owned_pet"]);
  assert.equal(scan.classes[0]!.fields.length, 26);
  assert.deepEqual(scan.stores.map((s) => [s.name, s.key, s.value]), [["SaveStore", "player", "player_saved"]]);
});

test("import then check reproduces the published format exactly", () => {
  const reporter = new Reporter();
  const text = importSchema(scan, ["save_format.verse"], reporter);
  assert.deepEqual(errors(reporter), []);
  const imported = analyze(text);
  assert.deepEqual(imported.codes, [], imported.rendered);
  const check = new Reporter();
  checkAgainst(imported.schema, scan, check);
  assert.deepEqual(check.diagnostics.map(render), []);
});

test("the SellThings demo schema matches the published format and passes its lock", () => {
  const demo = analyze(demoText);
  assert.deepEqual(demo.codes, [], demo.rendered);
  demo.schema.settings.kind = "player";
  const check = new Reporter();
  checkAgainst(demo.schema, scan, check);
  assert.deepEqual(check.diagnostics.map(render), []);
  const published = buildSnapshot(analyze(importSchema(scan, ["save_format.verse"], new Reporter())).schema);
  const compared = new Reporter();
  compareHistory(demo.schema, [published], compared);
  assert.deepEqual(compared.diagnostics.map(render), []);
});

test("check reports a missing field, a type change and an extra field", () => {
  const edited = demoText
    .replace('@map("CrateWorth")', '@map("CrateWorthX")')
    .replace("  TutorialStep     Int                  @min(0) @max(TutorialSteps)", "  TutorialStep     Float");
  const demo = analyze(edited);
  assert.deepEqual(demo.codes, [], demo.rendered);
  demo.schema.settings.kind = "player";
  const check = new Reporter();
  checkAgainst(demo.schema, scan, check);
  assert.deepEqual(check.diagnostics.map((d) => d.code).sort(), ["P202", "P203", "P205"]);
});
