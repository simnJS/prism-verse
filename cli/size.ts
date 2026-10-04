import type { Field, FieldType, ModelDecl, TypeDecl } from "./schema.ts";
import { persistedFields } from "./schema.ts";

// Upper bounds, in bytes, of Verse's persistence JSON (see docs/size.md). Generated `PrismSize` uses the same numbers.
export const COST = {
  record: 256, // {"$package_name":"…","$class_name":"…"} with a package path of up to 120 characters
  key: 8, // "x_Name": plus a comma, on top of the name length
  int: 21,
  float: 32,
  bool: 6,
  enum: 160, // "package::enum::Value"
  stringBase: 4,
  stringChar: 6, // a character escaped as \uXXXX
  option: 8, // {"":value}
  list: 2,
  item: 1,
} as const;

export const PLAYER_MAP_LIMIT = 262144;
export const NOMINAL_STRING = 64;

// A fixed-size type has no list, no string and no nested variable part.
export function fixedSize(t: FieldType): number | undefined {
  if (t.container === "list") return undefined;
  const inner = baseFixed(t);
  if (inner === undefined) return undefined;
  return t.container === "option" ? inner + COST.option : inner;
}

function baseFixed(t: FieldType): number | undefined {
  const b = t.base;
  if (b.kind === "scalar") return b.name === "Int" ? COST.int : b.name === "Float" ? COST.float : b.name === "Bool" ? COST.bool : undefined;
  if (b.kind === "enum") return COST.enum;
  return recordFixed(b.decl);
}

export function recordFixed(d: ModelDecl | TypeDecl, seen = new Set<string>()): number | undefined {
  if (seen.has(d.name)) return undefined;
  seen.add(d.name);
  let total = COST.record;
  for (const f of persistedFields(d)) {
    const v = fixedSize(f.type);
    if (v === undefined) return undefined;
    total += f.persisted.length + COST.key + v;
  }
  return total;
}

// Largest size the record can reach. Strings count NOMINAL_STRING characters; unbounded lists are reported.
export function worstCase(d: ModelDecl | TypeDecl, unbounded: Field[], seen = new Set<string>()): number {
  if (seen.has(d.name)) return 0;
  seen.add(d.name);
  let total = COST.record;
  for (const f of persistedFields(d)) {
    total += f.persisted.length + COST.key;
    const item = itemWorst(f.type, unbounded, seen);
    if (f.type.container === "list") {
      const max = f.maxItems?.kind === "int" ? Number(f.maxItems.text) : undefined;
      if (max === undefined) {
        if (!f.maxItems) unbounded.push(f);
        total += COST.list;
      } else total += COST.list + max * (item + COST.item);
    } else total += f.type.container === "option" ? item + COST.option : item;
  }
  return total;
}

function itemWorst(t: FieldType, unbounded: Field[], seen: Set<string>): number {
  const b = t.base;
  if (b.kind === "record") return worstCase(b.decl, unbounded, new Set(seen));
  if (b.kind === "enum") return COST.enum;
  switch (b.name) {
    case "Int":
      return COST.int;
    case "Float":
      return COST.float;
    case "Bool":
      return COST.bool;
    case "String":
      return COST.stringBase + NOMINAL_STRING * COST.stringChar;
  }
}

export type SizeTerm =
  | { kind: "fixedList"; field: Field; itemBytes: number }
  | { kind: "stringList"; field: Field }
  | { kind: "recordList"; field: Field; decl: TypeDecl }
  | { kind: "string"; field: Field }
  | { kind: "optionString"; field: Field }
  | { kind: "optionRecord"; field: Field; decl: TypeDecl }
  | { kind: "record"; field: Field; decl: TypeDecl };

// The generated PrismSize is `constant + Σ terms`: one source for the Verse code and for the tests.
export function sizeTerms(d: ModelDecl | TypeDecl): { constant: number; terms: SizeTerm[] } {
  let constant = COST.record;
  const terms: SizeTerm[] = [];
  for (const f of persistedFields(d)) {
    constant += f.persisted.length + COST.key;
    const fixed = fixedSize(f.type);
    if (fixed !== undefined) {
      constant += fixed;
      continue;
    }
    const b = f.type.base;
    const string = b.kind === "scalar" && b.name === "String";
    if (f.type.container === "list") {
      constant += COST.list;
      const item = fixedSize({ base: b, container: "none" });
      if (item !== undefined) terms.push({ kind: "fixedList", field: f, itemBytes: item + COST.item });
      else if (string) terms.push({ kind: "stringList", field: f });
      else if (b.kind === "record") terms.push({ kind: "recordList", field: f, decl: b.decl });
    } else if (f.type.container === "option") {
      constant += COST.option;
      if (string) terms.push({ kind: "optionString", field: f });
      else if (b.kind === "record") terms.push({ kind: "optionRecord", field: f, decl: b.decl });
    } else if (string) {
      constant += COST.stringBase;
      terms.push({ kind: "string", field: f });
    } else if (b.kind === "record") terms.push({ kind: "record", field: f, decl: b.decl });
  }
  return { constant, terms };
}
