import { createHash } from "node:crypto";
import { isBuiltin, isReserved } from "./names.ts";
import { columnType, flatType, persistedFields, type Field, type ModelDecl, type Schema } from "./schema.ts";

// One saved field of a model record: a plain field, a column of a list, or a field of a flattened type.
export interface SavedKey {
  key: string; // stable identity: "Coins", "Mines.OreId", "Home.X"
  long: string; // the readable saved name: "Coins", "Mines_OreId", "Home_X"
  explicit: boolean; // @map fixes the saved name
  field: Field;
  list?: Field;
  parent?: Field;
}

export type CodeTable = Map<string, Map<string, string>>; // record class -> key -> saved name

export const NAMES_FORMAT = 1;

export function savedKeys(m: ModelDecl): SavedKey[] {
  const out: SavedKey[] = [];
  for (const f of persistedFields(m)) {
    const columns = columnType(f);
    const flat = columns ? undefined : flatType(f);
    if (columns) {
      for (const c of columns.fields) {
        out.push({ key: `${f.name}.${c.name}`, long: `${f.persisted}_${c.persisted}`, explicit: f.mapped || c.mapped, field: c, list: f });
      }
    } else if (flat) {
      for (const s of flat.fields) {
        out.push({ key: `${f.name}.${s.name}`, long: `${f.persisted}_${s.persisted}`, explicit: f.mapped || s.mapped, field: s, parent: f });
      }
    } else out.push({ key: f.name, long: f.persisted, explicit: f.mapped, field: f });
  }
  return out;
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

function candidate(key: string, attempt: number): string {
  const h = createHash("sha256").update(`${key}#${attempt}`).digest();
  if (attempt < 2) return LETTERS[h[0]! % 26]!;
  if (attempt < 64) return LETTERS[h[0]! % 26]! + ALNUM[h[1]! % 36]!;
  return LETTERS[h[0]! % 26]! + ALNUM[h[1]! % 36]! + ALNUM[h[2]! % 36]!;
}

// Saved names of every model record. Each key keeps, in order: its @map name, its published name, its name in
// names.json, else the first free code of its own hash sequence (keys are visited in alphabetical order, so the
// declaration order never matters). `names = "long"` replaces the last two with the readable name. Codes of removed
// fields stay reserved (and in names.json), so another field never reads their old data.
export function assignCodes(schema: Schema, published: CodeTable, previous: CodeTable, modules: ReadonlySet<string>): CodeTable {
  const table: CodeTable = new Map();
  for (const m of schema.models) {
    const keys = savedKeys(m);
    const codes = new Map<string, string>();
    const long = schema.settings.names === "long";
    const taken = new Set<string>();
    const usable = (code: string | undefined): code is string =>
      code !== undefined && !taken.has(code) && !isReserved(code) && !isBuiltin(code) && !modules.has(code) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(code);
    for (const k of keys) {
      if (!k.explicit) continue;
      codes.set(k.key, k.long);
      taken.add(k.long);
    }
    const auto = keys.filter((k) => !k.explicit).map((k) => k.key).sort();
    const longOf = new Map(keys.map((k) => [k.key, k.long]));
    const pub = published.get(m.recordClass);
    const sources = [pub, long ? undefined : previous.get(m.recordClass)];
    for (const source of sources) {
      for (const key of auto) {
        // Shapes published before 0.3 have no API key: a field is found by its readable saved name.
        const code = source?.get(key) ?? (source === pub ? pub?.get(longOf.get(key)!) : undefined);
        if (!codes.has(key) && usable(code)) {
          codes.set(key, code);
          taken.add(code);
        }
      }
    }
    const current = new Set(keys.map((k) => k.key));
    for (const source of sources) {
      for (const [key, code] of [...(source ?? [])].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (current.has(key) || codes.has(key) || !usable(code)) continue;
        codes.set(key, code);
        taken.add(code);
      }
    }
    for (const k of keys) {
      if (long && !codes.has(k.key)) {
        codes.set(k.key, k.long);
        taken.add(k.long);
      }
    }
    for (const key of auto) {
      if (codes.has(key)) continue;
      let attempt = 0;
      let code = candidate(key, attempt);
      while (!usable(code)) code = candidate(key, ++attempt);
      codes.set(key, code);
      taken.add(code);
    }
    table.set(m.recordClass, codes);
  }
  return table;
}

export function serializeNames(table: CodeTable): string {
  const records: Record<string, Record<string, string>> = {};
  for (const recordClass of [...table.keys()].sort()) {
    const codes = table.get(recordClass)!;
    records[recordClass] = Object.fromEntries([...codes.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }
  return JSON.stringify({ format: NAMES_FORMAT, records }, null, 2) + "\n";
}

export function parseNames(text: string): CodeTable | undefined {
  try {
    const data = JSON.parse(text) as { format?: number; records?: Record<string, Record<string, string>> };
    if (typeof data.format !== "number" || data.format > NAMES_FORMAT || typeof data.records !== "object" || data.records === null) return undefined;
    return new Map(Object.entries(data.records).map(([cls, codes]) => [cls, new Map(Object.entries(codes))]));
  } catch {
    return undefined;
  }
}

// Saved names recorded by published shapes; a later shape wins over an earlier one.
export function publishedCodes(snapshots: { records: Record<string, { name: string; api?: string }[]> }[]): CodeTable {
  const table: CodeTable = new Map();
  for (const s of snapshots) {
    for (const [cls, fields] of Object.entries(s.records)) {
      const codes = table.get(cls) ?? new Map<string, string>();
      for (const f of fields) codes.set(f.api ?? f.name, f.name);
      table.set(cls, codes);
    }
  }
  return table;
}

// The saved names in use: those assigned by the CLI, or a fresh assignment (tests, library use).
export function codesOf(schema: Schema, m: ModelDecl): Map<string, string> {
  if (!schema.codes) schema.codes = assignCodes(schema, new Map(), new Map(), new Set());
  return schema.codes.get(m.recordClass) ?? new Map();
}
