import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { persistedFields, type FieldType, type ModelDecl, type Schema, type TypeDecl } from "../cli/schema.ts";
import { shapeFields } from "../cli/shape.ts";
import { COST, sizeTerms } from "../cli/size.ts";
import { analyze, ROOT } from "./helpers.ts";

// Verse's persistence JSON as documented (verselang book, "Persistable"): metadata, x_ field prefix, {"":v} options,
// "package::enum::Value" enums. Values here are the worst cases of each type, and the package path is 120 characters.
const PACKAGE = "/" + "u".repeat(40) + "@fortnite.com/" + "P".repeat(30) + "/Verse/" + "M".repeat(120 - 86);

type Value = string | number | boolean | null | Value[] | { [k: string]: Value };

function sample(t: FieldType, items: number): Value {
  if (t.container === "list") return Array.from({ length: items }, () => sample({ base: t.base, container: "none" }, items));
  if (t.container === "option") return items % 2 === 0 ? null : sample({ base: t.base, container: "none" }, items);
  const b = t.base;
  if (b.kind === "record") return record(b.decl, items);
  if (b.kind === "enum") return b.decl.values.reduce((a, v) => (v.length > a.length ? v : a), "");
  switch (b.name) {
    case "Int":
      return "-9223372036854775808";
    case "Float":
      return "-1.7976931348623157e+308";
    case "Bool":
      return false;
    case "String":
      return 'é"\\'.repeat(items);
  }
}

function record(d: ModelDecl | TypeDecl, items: number): { [k: string]: Value } {
  const out: { [k: string]: Value } = {};
  for (const f of persistedFields(d)) out[f.persisted] = sample(f.type, items);
  return out;
}

function jsonString(text: string): string {
  let out = '"';
  for (const c of text) out += c === '"' || c === "\\" ? `\\${c}` : /[ -~]/.test(c) ? c : `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
  return out + '"';
}

function serialize(t: FieldType, v: Value, schema: Schema): string {
  if (t.container === "list") return `[${(v as Value[]).map((x) => serialize({ base: t.base, container: "none" }, x, schema)).join(",")}]`;
  if (t.container === "option") return v === null ? "false" : `{"":${serialize({ base: t.base, container: "none" }, v, schema)}}`;
  const b = t.base;
  if (b.kind === "record") return serializeRecord(b.decl, v as { [k: string]: Value }, schema);
  if (b.kind === "enum") return jsonString(`${PACKAGE}::${b.decl.verseName}::${String(v)}`);
  if (b.name === "String") return jsonString(String(v));
  return String(v);
}

// A model's lists of flat types are saved as one array per field (columns), without per-item metadata.
function serializeRecord(d: ModelDecl | TypeDecl, v: { [k: string]: Value }, schema: Schema): string {
  const parts = [`"$package_name":${jsonString(PACKAGE)}`, `"$class_name":${jsonString(d.recordClass)}`];
  if (d.kind === "type") {
    for (const f of persistedFields(d)) parts.push(`"x_${f.persisted}":${serialize(f.type, v[f.persisted]!, schema)}`);
    return `{${parts.join(",")}}`;
  }
  for (const sf of shapeFields(schema, d)) {
    if (!sf.list) {
      parts.push(`"x_${sf.name}":${serialize(sf.field.type, v[sf.name]!, schema)}`);
      continue;
    }
    const items = v[sf.list.persisted] as { [k: string]: Value }[];
    const column = items.map((item) => serialize(sf.field.type, item[sf.field.persisted]!, schema));
    parts.push(`"x_${sf.name}":[${column.join(",")}]`);
  }
  return `{${parts.join(",")}}`;
}

// What the generated PrismSize returns for this value.
function prismSize(d: ModelDecl | TypeDecl, v: { [k: string]: Value }): number {
  const { constant, terms } = sizeTerms(d);
  let total = constant;
  for (const t of terms) {
    const x = v[t.field.persisted]!;
    switch (t.kind) {
      case "fixedList":
        total += (x as Value[]).length * t.itemBytes;
        break;
      case "stringList":
        for (const s of x as string[]) total += s.length * COST.stringChar + COST.stringBase + COST.item;
        break;
      case "recordList":
        for (const r of x as { [k: string]: Value }[]) total += prismSize(t.decl, r) + COST.item;
        break;
      case "string":
        total += (x as string).length * COST.stringChar;
        break;
      case "optionString":
        if (x !== null) total += (x as string).length * COST.stringChar + COST.stringBase;
        break;
      case "optionRecord":
        if (x !== null) total += prismSize(t.decl, x as { [k: string]: Value });
        break;
      case "record":
        total += prismSize(t.decl, x as { [k: string]: Value });
        break;
      case "columns": {
        const items = x as { [k: string]: Value }[];
        total += items.length * t.rowBytes;
        for (const name of t.strings) {
          const field = t.decl.fields.find((f) => `${t.field.persisted}_${f.persisted}` === name)!;
          for (const item of items) total += (item[field.persisted] as string).length * COST.stringChar + COST.stringBase + COST.item;
        }
        break;
      }
    }
  }
  return total;
}

const STRESS = `model Stress {
  Name     String
  Tags     String[]
  Maybe    String?
  Inner    Inner
  Child    Inner?
  Children Inner[]
  Objects  Boxed[]
  Mode     Mode
  Modes    Mode[]
  Values   Float[]
}

type Inner {
  Label String
  Count Int
  Ok    Bool
  Kind  Mode
}

type Boxed {
  Label String
  Count Int

  @@rows
}

enum Mode { Easy Hard Nightmare }
`;

for (const [name, text] of [
  ["the SellThings demo", readFileSync(join(ROOT, "examples/sellthings/save.prism"), "utf8")],
  ["the quickstart", readFileSync(join(ROOT, "examples/quickstart/save.prism"), "utf8")],
  ["objects and columns", readFileSync(join(ROOT, "examples/measure/save.prism"), "utf8")],
  ["every kind of field", STRESS],
] as const) {
  test(`PrismSize never underestimates the serialized record: ${name}`, () => {
    const { schema, codes } = analyze(text);
    assert.deepEqual(codes, []);
    for (const d of [...schema.models, ...schema.types]) {
      for (const items of [0, 1, 7, 64]) {
        const value = record(d, items);
        const json = serializeRecord(d, value, schema).length;
        const bound = prismSize(d, value);
        assert.ok(bound >= json, `${d.recordClass} with ${items} items: PrismSize ${bound} < JSON ${json}`);
      }
    }
  });
}
