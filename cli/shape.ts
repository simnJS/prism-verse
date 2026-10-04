import { codesOf, savedKeys } from "./naming.ts";
import { columnType, flatType, persistedFields, type Field, type ModelDecl, type Schema, type TypeDecl } from "./schema.ts";
import { persistedDefault, verseType } from "./verse_text.ts";

// One field of a persisted record class, as it appears in the saved data.
export interface ShapeField {
  name: string; // the saved name: a short code by default, the @map name, or the field name for a type
  key: string; // stable identity: "Coins", "Mines.OreId", "Home.X"
  helper: string; // readable name of the record's With*/Get* helpers: "Coins", "MinesOreId", "HomeX"
  type: string;
  default: string;
  field: Field; // the schema field; for a column or a flattened field, the field of the type
  list?: Field; // a column of this list
  parent?: Field; // a field of this flattened type
}

export interface ShapeRecord {
  recordClass: string;
  decl: ModelDecl | TypeDecl;
  fields: ShapeField[];
}

// A model record: lists of flat types become one array per field, single flat types their own fields, and every
// saved name is short unless @map or `names = "long"` says otherwise. A type keeps its field names (it is also the
// in-memory value the game uses).
export function shapeFields(schema: Schema, d: ModelDecl | TypeDecl): ShapeField[] {
  if (d.kind === "type") {
    return persistedFields(d).map((f) => ({ name: f.persisted, key: f.name, helper: f.persisted, type: verseType(f.type), default: persistedDefault(schema, f), field: f }));
  }
  const codes = codesOf(schema, d);
  return savedKeys(d).map((k) => {
    const name = codes.get(k.key) ?? k.long;
    const helper = k.key.replace(".", "");
    if (k.list) return { name, key: k.key, helper, type: `[]${verseType(k.field.type)}`, default: "array{}", field: k.field, list: k.list };
    const sf: ShapeField = { name, key: k.key, helper, type: verseType(k.field.type), default: persistedDefault(schema, k.field), field: k.field };
    if (k.parent) sf.parent = k.parent;
    return sf;
  });
}

export function savedName(schema: Schema, m: ModelDecl, key: string): string {
  return codesOf(schema, m).get(key) ?? key;
}

// Types saved as objects somewhere: single fields and options that can't be flattened, @@rows lists, reachable from
// a model.
export function rowTypes(schema: Schema): TypeDecl[] {
  const seen = new Set<TypeDecl>();
  const visit = (d: ModelDecl | TypeDecl): void => {
    for (const f of persistedFields(d)) {
      if (f.type.base.kind !== "record" || columnType(f) || flatType(f)) continue;
      const t = f.type.base.decl;
      if (seen.has(t)) continue;
      seen.add(t);
      visit(t);
    }
  };
  for (const m of schema.models) visit(m);
  return schema.types.filter((t) => seen.has(t));
}

export function persistedRecords(schema: Schema): ShapeRecord[] {
  const decls: (ModelDecl | TypeDecl)[] = [...schema.models, ...rowTypes(schema)];
  return decls.map((d) => ({ recordClass: d.recordClass, decl: d, fields: shapeFields(schema, d) }));
}
