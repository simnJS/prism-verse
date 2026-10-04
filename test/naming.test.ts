import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSnapshot } from "../cli/lock.ts";
import { isBuiltin, isReserved } from "../cli/names.ts";
import { assignCodes, codesOf, parseNames, publishedCodes, serializeNames, type CodeTable } from "../cli/naming.ts";
import { persistedRecords, shapeFields } from "../cli/shape.ts";
import { analyze } from "./helpers.ts";

const SCHEMA = `model Save {
  Coins   Int = 0
  Level   Int = 1
  Gems    Int = 0
  Home    Spot
  Mines   Mine[]
  Pets    Pet[]
}

type Spot {
  X Int
  Y Int
}

type Mine {
  OreId Int
  Cell  Int
}

type Pet {
  Kind  Int
  Owner Spot?
}
`;

function codes(text: string, previous: CodeTable = new Map(), published: CodeTable = new Map(), modules: string[] = []): Map<string, string> {
  const a = analyze(text);
  assert.deepEqual(a.codes, [], a.rendered);
  return assignCodes(a.schema, published, previous, new Set(modules)).get("save_record")!;
}

const first = codes(SCHEMA);

test("every saved field gets a distinct short code, never a keyword, a builtin or a module", () => {
  const all = [...first.values()];
  assert.equal(new Set(all).size, all.length);
  for (const code of all) {
    assert.match(code, /^[a-z][a-z0-9]?$/);
    assert.ok(!isReserved(code) && !isBuiltin(code), code);
  }
  const avoided = codes(SCHEMA, new Map(), new Map(), [first.get("Coins")!]);
  assert.notEqual(avoided.get("Coins"), first.get("Coins"));
});

test("a large model still gets valid codes of at most two characters", () => {
  const fields = Array.from({ length: 300 }, (_, i) => `  Field${i} Int = 0`).join("\n");
  const big = codes(`model Save {\n${fields}\n}\n`);
  const all = [...big.values()];
  assert.equal(new Set(all).size, 300);
  assert.ok(all.every((c) => /^[a-z][a-z0-9]{0,2}$/.test(c) && !isReserved(c) && !isBuiltin(c)));
});

test("codes don't depend on the declaration order", () => {
  const reordered = SCHEMA.replace("  Coins   Int = 0\n  Level   Int = 1\n", "  Level   Int = 1\n  Coins   Int = 0\n").replace("  OreId Int\n  Cell  Int\n", "  Cell  Int\n  OreId Int\n");
  assert.deepEqual(codes(reordered), first);
});

test("with names.json, adding fields never moves an existing code", () => {
  const added = SCHEMA.replace("  Coins   Int = 0\n", "  Aaa Int = 0\n  Abc Int = 0\n  Coins   Int = 0\n  Zzz Int = 0\n");
  const next = codes(added, new Map([["save_record", first]]));
  for (const [key, code] of first) assert.equal(next.get(key), code, key);
});

test("a removed field keeps its code reserved, and gets it back if it returns", () => {
  const previous = new Map([["save_record", first]]);
  const removed = codes(SCHEMA.replace("  Gems    Int = 0\n", ""), previous);
  assert.equal(removed.get("Gems"), first.get("Gems"));
  const fresh = analyze(SCHEMA.replace("  Gems    Int = 0\n", "  Rubies  Int = 0\n"));
  const table = assignCodes(fresh.schema, new Map(), previous, new Set()).get("save_record")!;
  assert.notEqual(table.get("Rubies"), first.get("Gems"));
  assert.equal(codes(SCHEMA, new Map([["save_record", removed]])).get("Gems"), first.get("Gems"));
});

test("published names win over names.json and over the hash", () => {
  const published = new Map([["save_record", new Map([["Coins", "zz"]])]]);
  const previous = new Map([["save_record", new Map([["Coins", "q"]])]]);
  assert.equal(codes(SCHEMA, previous, published).get("Coins"), "zz");
  assert.equal(codes(SCHEMA, previous).get("Coins"), "q");
});

test("a published shape records the code and the API name, and freezes it", () => {
  const a = analyze(SCHEMA);
  const snapshot = buildSnapshot(a.schema);
  const coins = snapshot.records["save_record"]!.find((f) => f.api === "Coins")!;
  assert.equal(coins.name, codesOf(a.schema, a.schema.models[0]!).get("Coins"));
  assert.deepEqual(publishedCodes([snapshot]).get("save_record"), codesOf(a.schema, a.schema.models[0]!));
});

test("@map keeps its name; names = \"long\" saves readable names", () => {
  const mapped = codes(SCHEMA.replace("  Coins   Int = 0\n", '  Coins   Int = 0 @map("Money")\n'));
  assert.equal(mapped.get("Coins"), "Money");
  const long = codes(`generator {\n  names = "long"\n}\n\n${SCHEMA}`);
  assert.equal(long.get("Coins"), "Coins");
  assert.equal(long.get("Mines.OreId"), "Mines_OreId");
  assert.equal(long.get("Home.X"), "Home_X");
});

test("a single flat type is flattened into the record; an option of it is saved as an object", () => {
  const a = analyze(SCHEMA);
  const fields = shapeFields(a.schema, a.schema.models[0]!);
  assert.deepEqual(fields.map((f) => f.key), ["Coins", "Level", "Gems", "Home.X", "Home.Y", "Mines.OreId", "Mines.Cell", "Pets"]);
  assert.deepEqual(fields.map((f) => f.helper), ["Coins", "Level", "Gems", "HomeX", "HomeY", "MinesOreId", "MinesCell", "Pets"]);
  assert.deepEqual(persistedRecords(a.schema).map((r) => r.recordClass), ["save_record", "spot", "pet"]);
});

test("names.json round-trips and rejects a newer format", () => {
  const table = new Map([["save_record", first]]);
  assert.deepEqual(parseNames(serializeNames(table)), table);
  assert.equal(parseNames('{"format":2,"records":{}}'), undefined);
  assert.equal(parseNames("{"), undefined);
});
