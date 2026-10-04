import { columnType, persistedFields, type Field, type FieldType, type ModelDecl, type Schema, type TypeDecl } from "./schema.ts";
import { shapeFields } from "./shape.ts";

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
    const columns = columnType(f);
    if (columns) {
      const max = f.maxItems?.kind === "int" ? Number(f.maxItems.text) : undefined;
      if (max === undefined && !f.maxItems) unbounded.push(f);
      for (const c of columns.fields) {
        total += f.persisted.length + c.persisted.length + 1 + COST.key + COST.list + (max ?? 0) * (itemWorst(c.type, unbounded, seen) + COST.item);
      }
      continue;
    }
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

// `name` is the saved name of the field in the record (a short code for a model record).
export type SizeTerm =
  | { kind: "fixedList"; field: Field; name: string; itemBytes: number }
  | { kind: "stringList"; field: Field; name: string }
  | { kind: "recordList"; field: Field; name: string; decl: TypeDecl }
  | { kind: "string"; field: Field; name: string }
  | { kind: "optionString"; field: Field; name: string }
  | { kind: "optionRecord"; field: Field; name: string; decl: TypeDecl }
  | { kind: "record"; field: Field; name: string; decl: TypeDecl }
  | { kind: "columns"; field: Field; decl: TypeDecl; first: string; columns: string[]; rowBytes: number; strings: string[] };

// The generated PrismSize is `constant + Σ terms`: one source for the Verse code and for the tests.
export function sizeTerms(schema: Schema, d: ModelDecl | TypeDecl): { constant: number; terms: SizeTerm[] } {
  let constant = COST.record;
  const terms: SizeTerm[] = [];
  const lists = new Map<Field, Extract<SizeTerm, { kind: "columns" }>>();
  for (const sf of shapeFields(schema, d)) {
    constant += sf.name.length + COST.key;
    if (sf.list) {
      constant += COST.list;
      let term = lists.get(sf.list);
      if (!term) {
        term = { kind: "columns", field: sf.list, decl: columnType(sf.list)!, first: sf.name, columns: [], rowBytes: 0, strings: [] };
        lists.set(sf.list, term);
        terms.push(term);
      }
      term.columns.push(sf.name);
      const fixed = fixedSize(sf.field.type);
      if (fixed === undefined) term.strings.push(sf.name);
      else term.rowBytes += fixed + COST.item;
      continue;
    }
    const f = sf.field;
    const name = sf.name;
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
      if (item !== undefined) terms.push({ kind: "fixedList", field: f, name, itemBytes: item + COST.item });
      else if (string) terms.push({ kind: "stringList", field: f, name });
      else if (b.kind === "record") terms.push({ kind: "recordList", field: f, name, decl: b.decl });
    } else if (f.type.container === "option") {
      constant += COST.option;
      if (string) terms.push({ kind: "optionString", field: f, name });
      else if (b.kind === "record") terms.push({ kind: "optionRecord", field: f, name, decl: b.decl });
    } else if (string) {
      constant += COST.stringBase;
      terms.push({ kind: "string", field: f, name });
    } else if (b.kind === "record") terms.push({ kind: "record", field: f, name, decl: b.decl });
  }
  return { constant, terms };
}
