import type { Diagnostic, Reporter } from "./diagnostics.ts";
import { sha256 } from "./hash.ts";
import { columnType, flatType, persistedFields, type Schema } from "./schema.ts";
import { persistedRecords, type ShapeField, type ShapeRecord } from "./shape.ts";
import type { SourceFile, Span } from "./source.ts";

export const LOCK_FORMAT = 1;

export interface LockedField {
  name: string;
  type: string;
  default: string;
  api?: string;
}

export interface LockedStore {
  model: string;
  store: string;
  record: string;
  version: number;
}

export interface LockedMigration {
  step: number;
  fn: string;
}

// One published shape: what saves written by that version of the island contain.
export interface Snapshot {
  format: number;
  kind: string;
  stores: LockedStore[];
  records: Record<string, LockedField[]>;
  enums: Record<string, string[]>;
  migrations: Record<string, LockedMigration[]>;
  checksum: string;
}

export function buildSnapshot(schema: Schema): Snapshot {
  const records: Record<string, LockedField[]> = {};
  for (const r of persistedRecords(schema).sort((a, b) => a.recordClass.localeCompare(b.recordClass))) {
    records[r.recordClass] = r.fields.map((f) => {
      const locked: LockedField = { name: f.name, type: f.type, default: f.default };
      if (r.decl.kind === "model" || f.key !== f.name) locked.api = f.key;
      return locked;
    });
  }
  const enums: Record<string, string[]> = {};
  for (const e of [...schema.enums].sort((a, b) => a.verseName.localeCompare(b.verseName))) enums[e.verseName] = [...e.values];
  const models = [...schema.models].sort((a, b) => a.storeVar.localeCompare(b.storeVar));
  const migrations: Record<string, LockedMigration[]> = {};
  for (const m of models) migrations[m.storeVar] = m.migrations.map((x) => ({ step: x.step, fn: x.fn }));
  return {
    format: LOCK_FORMAT,
    kind: schema.settings.kind,
    stores: models.map((m) => ({ model: m.name, store: m.storeVar, record: m.recordClass, version: m.version })),
    records,
    enums,
    migrations,
    checksum: migrationChecksum(migrations),
  };
}

function migrationChecksum(migrations: Record<string, LockedMigration[]>): string {
  return `sha256:${sha256(JSON.stringify(migrations))}`;
}

export function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify(snapshot, null, 2) + "\n";
}

export function parseSnapshot(file: SourceFile, reporter: Reporter): Snapshot | undefined {
  const fail = (why: string): undefined => {
    reporter.error("P109", `can't read the published shape ${file.name}: ${why}`, { file, span: { start: 0, end: 0 } }, {
      help: "restore it from version control: published shapes are never edited by hand",
    });
    return undefined;
  };
  let data: unknown;
  try {
    data = JSON.parse(file.text);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "invalid JSON");
  }
  if (typeof data !== "object" || data === null) return fail("not an object");
  const s = data as Partial<Snapshot>;
  if (typeof s.format !== "number") return fail("missing `format`");
  if (s.format > LOCK_FORMAT) return fail(`format ${s.format} comes from a newer prism-verse; update it`);
  if (typeof s.kind !== "string" || !Array.isArray(s.stores) || !isObject(s.records) || !isObject(s.enums) || !isObject(s.migrations) || typeof s.checksum !== "string") {
    return fail("missing sections");
  }
  if (migrationChecksum(s.migrations) !== s.checksum) return fail("its migration list doesn't match its checksum (edited by hand?)");
  return s as Snapshot;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Compares the schema with every published shape; each problem is reported once.
export function compareHistory(schema: Schema, snapshots: Snapshot[], reporter: Reporter): void {
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    const local = new LocalReporter();
    compareSnapshot(schema, snapshot, local);
    for (const d of local.diagnostics) {
      const key = `${d.code}|${d.message}|${d.span?.start ?? -1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      reporter.diagnostics.push(d);
    }
  }
}

class LocalReporter {
  readonly diagnostics: Diagnostic[] = [];
  error(code: string, message: string, at?: { file: SourceFile; span: Span }, extra: { help?: string; label?: string } = {}): void {
    const d: Diagnostic = { code, severity: "error", message };
    if (at) {
      d.file = at.file;
      d.span = at.span;
    }
    if (extra.help !== undefined) d.help = extra.help;
    if (extra.label !== undefined) d.label = extra.label;
    this.diagnostics.push(d);
  }
}

type Sink = Pick<LocalReporter, "error">;

// Reports every change that would make saves written with this shape unreadable.
export function compareSnapshot(schema: Schema, lock: Snapshot, reporter: Sink): void {
  const file = schema.file;
  const at = (span: Span): { file: SourceFile; span: Span } => ({ file, span });
  const top = { start: 0, end: 0 };
  if (lock.kind !== schema.settings.kind) {
    reporter.error("P107", `\`kind\` changed from "${lock.kind}" to "${schema.settings.kind}"`, at(top), {
      help: "switching between memory and player is a new store, not an edit: restore the kind",
    });
  }
  const decls = new Map<string, ShapeRecord>();
  for (const r of persistedRecords(schema)) decls.set(r.recordClass, r);
  const reportedRecords = new Set<string>();

  for (const locked of lock.stores) {
    const model = schema.models.find((m) => m.storeVar === locked.store);
    if (!model) {
      const renamed = schema.models.find((m) => m.name === locked.model);
      if (renamed) {
        reporter.error("P106", `the store of \`${renamed.name}\` was renamed from \`${locked.store}\` to \`${renamed.storeVar}\``, at(renamed.node.name.span), {
          help: `restore it: \`@@store("${locked.store}")\``,
        });
      } else {
        reporter.error("P106", `model \`${locked.model}\` (store \`${locked.store}\`) was removed`, at(top), { help: "put the model back: its saves can't be dropped once published" });
      }
      reportedRecords.add(locked.record);
      continue;
    }
    if (model.recordClass !== locked.record) {
      reporter.error("P104", `the record of \`${model.name}\` was renamed from \`${locked.record}\` to \`${model.recordClass}\``, at(model.node.name.span), {
        help: `restore it: \`@@map("${locked.record}")\``,
      });
      reportedRecords.add(locked.record);
    }
    if (model.version < locked.version) {
      reporter.error("P108", `the version of \`${model.name}\` went down from ${locked.version} to ${model.version}`, at(model.node.name.span), {
        help: `keep every \`@@migrate\` step up to ${locked.version}`,
      });
    }
    for (const step of lock.migrations[locked.store] ?? []) {
      const current = model.migrations.find((x) => x.step === step.step);
      if (!current) {
        if (step.step <= model.version) {
          reporter.error("P110", `published migration step ${step.step} (\`${step.fn}\`) of \`${model.name}\` was removed`, at(model.node.name.span), {
            help: `restore \`@@migrate(${step.step}, ${step.fn})\`: saves of version ${step.step - 1} still need it`,
          });
        }
      } else if (current.fn !== step.fn) {
        reporter.error("P110", `published migration step ${step.step} of \`${model.name}\` changed from \`${step.fn}\` to \`${current.fn}\``, at(current.span), {
          help: `keep \`@@migrate(${step.step}, ${step.fn})\` and add a new step for the new conversion`,
        });
      }
    }
  }

  const missing = Object.keys(lock.records).filter((r) => !decls.has(r));
  const mentionsMissing = (type: string): boolean => missing.some((r) => type.replace(/^(\[\]|\?)/, "") === r);
  for (const [record, fields] of Object.entries(lock.records)) {
    const d = decls.get(record);
    if (!d) {
      const unsaved = schema.models.flatMap((m) => persistedFields(m)).map((f) => columnType(f) ?? flatType(f)).find((t) => t?.recordClass === record);
      if (unsaved) {
        reporter.error("P104", `\`${record}\` was saved as objects and no longer is`, at(unsaved.node.name.span), {
          help: `add \`@@rows\` to \`type ${unsaved.name}\` to keep the published format`,
        });
      } else if (!reportedRecords.has(record)) {
        reporter.error("P104", `record \`${record}\` was removed or renamed`, at(top), { help: `restore the type, with \`@@map("${record}")\` if you renamed it` });
      }
      continue;
    }
    const current = new Map<string, ShapeField>();
    for (const f of d.fields) current.set(f.name, f);
    const lockedNames = new Set(fields.map((f) => f.name));
    for (const lf of fields) {
      const sf = current.get(lf.name);
      if (!sf) {
        reportRemoved(schema, d, lf, lockedNames, reporter);
        continue;
      }
      const f = sf.field;
      if (sf.type !== lf.type && !mentionsMissing(lf.type)) {
        reporter.error("P102", `persisted field ${fieldLabel(lf)} changed type from \`${lf.type}\` to \`${sf.type}\``, at(f.node.type.span), {
          help: `keep \`${sf.key}\` as it was (mark it \`@deprecated\`), add a new field and convert it in a \`@@migrate\` step`,
        });
      }
      if (sf.type === lf.type && sf.default !== lf.default) {
        reporter.error("P103", `persisted default of \`${sf.key}\` changed from \`${lf.default}\` to \`${sf.default}\``, at((f.def ?? f.node.name).span), {
          label: `saves written before this field existed would load ${sf.default}`,
          help: `keep \`= ${verseToSchema(lf.default)}\`; use \`@initial(${f.def ? schema.file.text.slice(f.def.span.start, f.def.span.end) : verseToSchema(sf.default)})\` to give new players another value`,
        });
      }
    }
  }

  for (const [name, values] of Object.entries(lock.enums)) {
    const e = schema.enums.find((x) => x.verseName === name);
    if (!e) {
      reporter.error("P105", `enum \`${name}\` was removed or renamed`, at(top), { help: "restore it: saved values refer to it by name" });
      continue;
    }
    for (const v of values) {
      if (!e.values.includes(v)) {
        reporter.error("P105", `enum value \`${e.name}.${v}\` was removed or renamed`, at(e.node.name.span), { help: `keep \`${v}\`; add new values after the existing ones` });
      }
    }
  }
}

// "`Coins`", or "`Level` (saved as `b`)" when the saved name is a code or an @map name.
function fieldLabel(lf: LockedField): string {
  const api = lf.api ?? lf.name;
  return api === lf.name ? `\`${api}\`` : `\`${api}\` (saved as \`${lf.name}\`)`;
}

function reportRemoved(schema: Schema, r: ShapeRecord, lf: LockedField, lockedNames: Set<string>, reporter: Sink): void {
  const d = r.decl;
  const apiName = lf.api ?? lf.name;
  const remapped = r.fields.find((f) => f.key === apiName && f.name !== lf.name);
  const sameName = d.fields.find((f) => f.name === apiName);
  const reshaped = sameName && !sameName.transient ? (columnType(sameName) ?? flatType(sameName)) : undefined;
  const newcomer = r.fields.find((f) => !lockedNames.has(f.name) && f.type === lf.type && !f.key.includes("."));
  const part = /^(\w+)\.(\w+)$/.exec(apiName);
  const owner = part ? d.fields.find((f) => f.name === part[1]) : undefined;
  let help = part && owner
    ? `\`${apiName}\` is the field \`${part[2]}\` of the type of \`${owner.name}\`: put it back in that type, marked \`@deprecated\` if unused`
    : `put it back as \`${apiName} ${schemaType(lf.type)} = ${verseToSchema(lf.default)} @deprecated${apiName === lf.name ? "" : ` @map("${lf.name}")`}\``;
  let span = d.node.name.span;
  if (remapped) {
    help = `\`${apiName}\` was saved as \`${lf.name}\`: restore \`@map("${lf.name}")\``;
    span = (remapped.parent ?? remapped.list ?? remapped.field).node.name.span;
  } else if (reshaped && sameName) {
    help = `\`${apiName}\` was saved as ${sameName.type.container === "list" ? "a list of objects" : "an object"}: add \`@@rows\` to \`type ${reshaped.name}\` to keep that format`;
    span = sameName.node.name.span;
  } else if (sameName?.transient) {
    help = "a saved field can't become `@transient`: keep it saved, or mark it `@deprecated` and add a transient field with another name";
    span = sameName.node.name.span;
  } else if (newcomer) {
    help = `if \`${newcomer.key}\` is \`${apiName}\` renamed, keep the saved name: \`${newcomer.key} ${schemaType(lf.type)} @map("${lf.name}")\``;
    span = newcomer.field.node.name.span;
  }
  reporter.error("P101", `persisted field ${fieldLabel(lf)} of \`${d.recordClass}\` was removed`, { file: schema.file, span }, { help });
}

function schemaType(verse: string): string {
  if (verse.startsWith("[]")) return `${schemaType(verse.slice(2))}[]`;
  if (verse.startsWith("?")) return `${schemaType(verse.slice(1))}?`;
  return { int: "Int", float: "Float", logic: "Bool", string: "String" }[verse] ?? verse;
}

export function verseToSchema(value: string): string {
  if (value === "array{}") return "[]";
  const list = /^array\{(.*)\}$/.exec(value);
  return list ? `[${list[1]}]` : value;
}
