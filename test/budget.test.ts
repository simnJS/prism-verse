import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "./helpers.ts";

// FitsInPlayerMap serializes the whole record (tens of ms per thousand ints): a flush may call it once, never in a loop.
const stores = ["examples/quickstart/player_save_store.verse", "examples/sellthings/demo_save_store.verse", "test/fixtures/coverage/coverage_store.verse"];

function methods(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const head = /^ {4}(\w+)<\w+>\(/.exec(lines[i]!);
    if (!head) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length && (lines[j]!.startsWith("        ") || lines[j] === ""); j++) body.push(lines[j]!);
    out.set(head[1]!, body.join("\n"));
  }
  return out;
}

for (const path of stores) {
  test(`one FitsInPlayerMap per flush, outside any loop: ${path}`, () => {
    const text = readFileSync(join(ROOT, path), "utf8");
    const bodies = methods(text);
    const callers = [...bodies].filter(([, body]) => body.includes("FitsInPlayerMap")).map(([name]) => name);
    assert.deepEqual(callers, ["Fit"]);
    const fit = bodies.get("Fit")!;
    assert.equal(fit.match(/FitsInPlayerMap/g)?.length, 1);
    assert.doesNotMatch(fit, /^\s*(loop:|for \()/m);
    assert.match(fit, /if \(Size <= PrismFitsCheckMax\):\n\s+if \(FitsInPlayerMap\[Rec\]\)/);
    for (const [name, body] of bodies) {
      if (name.startsWith("Trim")) assert.doesNotMatch(body, /FitsInPlayerMap|loop:/, `${name} must trim by arithmetic`);
    }
    const flush = bodies.get("Flush")!;
    assert.match(flush, /if \(Checked\?, Now < Model\.NextCheckAt\)/, "a large record is checked at most every PrismLargeRecordSeconds");
  });
}
