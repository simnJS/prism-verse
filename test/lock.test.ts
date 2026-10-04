import assert from "node:assert/strict";
import { test } from "node:test";
import { Reporter } from "../cli/diagnostics.ts";
import { buildSnapshot, compareHistory, parseSnapshot, serializeSnapshot, type Snapshot } from "../cli/lock.ts";
import { SourceFile } from "../cli/source.ts";
import { analyze } from "./helpers.ts";

const BASE = `datasource {
  kind = "player"
}

model Save {
  Version Int   = 1   @version
  Coins   Float = 0.0 @map("Money")
  Level   Int   = 1
  Items   Item[]
  Mode    Mode  = Mode.Easy
  Home    Spot
  Recent  Int[]       @transient

  @@store("SaveData")
}

type Item {
  Id   Int @id
  Kind Int
}

type Spot {
  X Int
}

enum Mode { Easy Hard }
`;

function compare(history: Snapshot[], text: string): Reporter {
  const next = analyze(text);
  assert.deepEqual(next.codes, [], `the edited schema itself is invalid:\n${next.rendered}`);
  const reporter = new Reporter();
  compareHistory(next.schema, history, reporter);
  return reporter;
}

function breaking(edit: (text: string) => string): string[] {
  return compare([buildSnapshot(analyze(BASE).schema)], edit(BASE)).diagnostics.map((d) => d.code);
}

const WITH_STEP = BASE.replace('  @@store("SaveData")', '  @@store("SaveData")\n  @@migrate(2, Upgrade)');

test("the base schema is valid", () => assert.deepEqual(analyze(BASE).codes, []));

test("adding a field with a default is allowed", () => {
  assert.deepEqual(breaking((t) => t.replace("  Level   Int   = 1\n", "  Level   Int   = 1\n  Gems    Int   = 0\n")), []);
});

test("renaming a field in the API while keeping its saved name is allowed", () => {
  assert.deepEqual(breaking((t) => t.replace("  Level   Int   = 1\n", '  Rank    Int   = 1 @map("Level")\n')), []);
});

test("adding an enum value and a migration step are allowed", () => {
  assert.deepEqual(breaking((t) => t.replace("enum Mode { Easy Hard }", "enum Mode { Easy Hard Nightmare }").replace('  @@store("SaveData")', '  @@store("SaveData")\n  @@migrate(2, Upgrade)')), []);
});

test("P101: removing a persisted field", () => {
  assert.deepEqual(breaking((t) => t.replace("  Level   Int   = 1\n", "")), ["P101"]);
});

test("P101: changing the saved name with @map", () => {
  assert.deepEqual(breaking((t) => t.replace('@map("Money")', '@map("Cash")')), ["P101"]);
});

test("P101: turning a persisted field into a transient one", () => {
  assert.deepEqual(breaking((t) => t.replace("  Level   Int   = 1\n", "  Level   Int   = 1 @transient\n")), ["P101"]);
});

test("P101: removing a field of a type saved in columns removes its column", () => {
  assert.deepEqual(breaking((t) => t.replace("  Kind Int\n", "")), ["P101"]);
});

test("adding a field to a type saved in columns adds a column", () => {
  assert.deepEqual(breaking((t) => t.replace("  Kind Int\n", "  Kind Int\n  Rare Bool\n")), []);
});

test("renaming a type saved in columns is free: its class is not in the save", () => {
  assert.deepEqual(breaking((t) => t.replace("type Item {", "type Thing {").replace("Items   Item[]", "Items   Thing[]")), []);
});

test("P101: switching a published column list to @@rows", () => {
  assert.deepEqual(breaking((t) => t.replace("  Kind Int\n}", "  Kind Int\n\n  @@rows\n}")), ["P101", "P101"]);
});

test("P102: changing the type of a persisted field", () => {
  assert.deepEqual(breaking((t) => t.replace("  Level   Int   = 1\n", "  Level   Float = 1.0\n")), ["P102"]);
});

test("P103: changing a persisted default", () => {
  assert.deepEqual(breaking((t) => t.replace("  Level   Int   = 1\n", "  Level   Int   = 2\n")), ["P103"]);
});

test("P103 is not raised by @initial", () => {
  assert.deepEqual(breaking((t) => t.replace("  Level   Int   = 1\n", "  Level   Int   = 1 @initial(2)\n")), []);
});

test("P104: renaming the class of a type saved as an object", () => {
  assert.deepEqual(breaking((t) => t.replace("  X Int\n", '  X Int\n\n  @@map("spot_v2")\n')), ["P104"]);
});

test("P104: renaming the record of a model", () => {
  assert.deepEqual(breaking((t) => t.replace('  @@store("SaveData")', '  @@store("SaveData")\n  @@map("save_v2")')), ["P104"]);
});

test("P105: removing an enum value", () => {
  assert.deepEqual(breaking((t) => t.replace("enum Mode { Easy Hard }", "enum Mode { Easy }")), ["P105"]);
});

test("P106: renaming the store variable", () => {
  assert.deepEqual(breaking((t) => t.replace('@@store("SaveData")', '@@store("SaveData2")')), ["P106"]);
});

test("P107: changing the datasource kind", () => {
  assert.deepEqual(breaking((t) => t.replace('kind = "player"', 'kind = "memory"')), ["P107"]);
});

test("P108: removing the last migration step", () => {
  assert.deepEqual(compare([buildSnapshot(analyze(WITH_STEP).schema)], BASE).diagnostics.map((d) => d.code), ["P108"]);
});

test("P110: changing a published migration step", () => {
  const codes = compare([buildSnapshot(analyze(WITH_STEP).schema)], WITH_STEP.replace("Upgrade)", "Upgrade2)")).diagnostics.map((d) => d.code);
  assert.deepEqual(codes, ["P110"]);
});

test("P109: unreadable, newer or hand-edited snapshots", () => {
  const good = serializeSnapshot(buildSnapshot(analyze(WITH_STEP).schema));
  for (const text of ["not json", '{"format": 99}', '{"format": 1}', good.replace('"fn": "Upgrade"', '"fn": "Other"')]) {
    const reporter = new Reporter();
    assert.equal(parseSnapshot(new SourceFile("0001.json", text), reporter), undefined);
    assert.deepEqual(reporter.diagnostics.map((d) => d.code), ["P109"]);
  }
});

test("a snapshot is stable and round-trips", () => {
  const text = serializeSnapshot(buildSnapshot(analyze(BASE).schema));
  assert.equal(text, serializeSnapshot(buildSnapshot(analyze(BASE).schema)));
  const parsed = parseSnapshot(new SourceFile("0001.json", text), new Reporter());
  assert.ok(parsed);
  assert.equal(serializeSnapshot(parsed), text);
});

test("unpublished edits are free: only recorded shapes are compared", () => {
  const draft = BASE.replace("  Level   Int   = 1\n", "  Level   Int   = 1\n  Draft   Int   = 0\n");
  assert.deepEqual(analyze(draft).codes, []);
  const published = buildSnapshot(analyze(BASE).schema);
  assert.deepEqual(compare([published], draft.replace("  Draft   Int   = 0\n", "  Draft   Int   = 7\n")).diagnostics, []);
});

test("every published shape is checked, and each problem is reported once", () => {
  const first = buildSnapshot(analyze(BASE).schema);
  const second = buildSnapshot(analyze(BASE.replace("enum Mode { Easy Hard }", "enum Mode { Easy Hard Nightmare }")).schema);
  const codes = compare([first, second], BASE.replace("  Level   Int   = 1\n", "")).diagnostics.map((d) => d.code);
  assert.deepEqual(codes, ["P101", "P105"]);
});

test("a removed field next to a new one of the same type suggests @map", () => {
  const reporter = compare([buildSnapshot(analyze(BASE).schema)], BASE.replace("  Level   Int   = 1\n", "  Rank    Int   = 1\n"));
  assert.equal(reporter.diagnostics[0]?.code, "P101");
  assert.match(reporter.diagnostics[0]?.help ?? "", /@map\("Level"\)/);
});
