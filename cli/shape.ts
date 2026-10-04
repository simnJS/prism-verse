import { columnType, persistedFields, type Field, type ModelDecl, type Schema, type TypeDecl } from "./schema.ts";
import { persistedDefault, verseType } from "./verse_text.ts";

// One field of a persisted record class, as it appears in the saved data.
export interface ShapeField {
  name: string;
  type: string;
  default: string;
  field: Field; // the schema field; for a column, the field of the item type
  list?: Field; // for a column, the list it belongs to
}

export interface ShapeRecord {
  recordClass: string;
  decl: ModelDecl | TypeDecl;
  fields: ShapeField[];
}

export function columnName(list: Field, field: Field): string {
  return `${list.persisted}_${field.persisted}`;
}

// A list of a flat type is saved as one array per field of the type ("columns"), without per-item metadata.
export function shapeFields(schema: Schema, d: ModelDecl | TypeDecl): ShapeField[] {
  const out: ShapeField[] = [];
  for (const f of persistedFields(d)) {
    const columns = columnType(f);
    if (!columns) {
      out.push({ name: f.persisted, type: verseType(f.type), default: persistedDefault(schema, f), field: f });
      continue;
    }
    for (const c of columns.fields) {
      out.push({ name: columnName(f, c), type: `[]${verseType(c.type)}`, default: "array{}", field: c, list: f });
    }
  }
  return out;
}

// Types saved as objects somewhere: single fields, options and @@rows lists, reachable from a model.
export function rowTypes(schema: Schema): TypeDecl[] {
  const seen = new Set<TypeDecl>();
  const visit = (d: ModelDecl | TypeDecl): void => {
    for (const f of persistedFields(d)) {
      if (f.type.base.kind !== "record" || columnType(f)) continue;
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
