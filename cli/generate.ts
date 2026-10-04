import type { Literal } from "./ast.ts";
import { fresh, pascal, snake } from "./names.ts";
import {
  columnType, idField, inModel, isIdList, isMetadata, isNumeric, isPersisted, MODEL_MEMBERS, memberNames, persistedFields, trimmedLists,
  type Field, type FieldType, type ModelDecl, type Schema, type TypeDecl,
} from "./schema.ts";
import { columnName, shapeFields } from "./shape.ts";
import { COST, recordFixed, sizeTerms } from "./size.ts";
import * as text from "./verse_text.ts";
import { VERSION } from "./version.ts";

export interface GeneratedFile {
  name: string;
  text: string;
}

export interface GenerateOptions {
  lib: string;
  schemaName: string;
  schemaHash: string;
  // Names of the project's Verse modules (folders): generated locals avoid them.
  reserved?: ReadonlySet<string>;
}

export function generate(schema: Schema, options: GenerateOptions): GeneratedFile[] {
  const g = new Generator(schema, options);
  const prefix = schema.settings.prefix;
  const reserved = options.reserved ?? new Set<string>();
  return [
    { name: `${prefix}_records.verse`, text: renameLocals(g.records(), ["Record", "Value", "Source"], reserved) },
    { name: `${prefix}_model.verse`, text: g.models() },
    { name: `${prefix}_store.verse`, text: renameLocals(g.stores(), STORE_LOCALS, reserved) },
  ];
}

const STORE_LOCALS = [
  "Who", "Force", "Debounce", "Model", "Live", "Saved", "Rec", "Size", "Checked", "Fitted", "Final", "Written", "Now", "Kept",
  "Other", "Budget", "KeepCount", "Count", "Current", "Item", "Inner",
];

// A local named like a project module is ambiguous in Verse: rename it everywhere it isn't a member access.
function renameLocals(text: string, names: string[], reserved: ReadonlySet<string>): string {
  let out = text;
  for (const name of names) {
    if (!reserved.has(name)) continue;
    const replacement = fresh(name, new Set([...reserved, ...names]));
    out = out.replace(new RegExp(`(?<![.\\w])${name}\\b`, "g"), replacement);
  }
  return out;
}

class Lines {
  private readonly out: string[] = [];

  line(depth: number, text: string): void {
    this.out.push(text === "" ? "" : "    ".repeat(depth) + text);
  }

  blank(): void {
    if (this.out.length > 0 && this.out[this.out.length - 1] !== "") this.out.push("");
  }

  toString(): string {
    while (this.out.length > 0 && this.out[this.out.length - 1] === "") this.out.pop();
    return this.out.join("\n") + "\n";
  }
}

class Generator {
  private readonly schema: Schema;
  private readonly options: GenerateOptions;
  private readonly prefix: string;

  constructor(schema: Schema, options: GenerateOptions) {
    this.schema = schema;
    this.options = options;
    this.prefix = schema.settings.methodPrefix;
  }

  // ---- files ----

  records(): string {
    const out = this.header(false);
    for (const e of this.schema.enums) {
      out.blank();
      out.line(0, `${e.verseName}<public> := enum<open><persistable>{${e.values.join(", ")}}`);
    }
    for (const d of this.decls()) {
      out.blank();
      out.line(0, `${d.recordClass}<public> := class<final><persistable>:`);
      for (const f of this.savedFields(d)) out.line(1, `${f.name}<public>:${f.type} = ${f.default}`);
    }
    for (const m of this.schema.models) {
      out.blank();
      out.line(0, `var ${m.storeVar}<internal>:${this.storeType(m)} = map{}`);
    }
    for (const d of this.decls()) {
      const fields = this.savedFields(d);
      out.blank();
      out.line(0, `${this.maker(d)}<constructor><public>(Source:${d.recordClass})<transacts> := ${d.recordClass}:`);
      for (const f of fields) out.line(1, `${f.name} := Source.${f.name}`);
      for (const f of fields) {
        out.blank();
        out.line(0, `(Record:${d.recordClass}).With${f.name}<public>(Value:${f.type})<transacts>:${d.recordClass} =`);
        this.copy(out, 1, d, "Record", [[f.name, "Value"]]);
      }
    }
    return out.toString();
  }

  models(): string {
    const out = this.header(true);
    for (const m of this.schema.models) {
      const members = this.members(m);
      const fields = m.fields.filter(inModel);
      const enumName = `${snake(m.name)}_field`;
      out.blank();
      out.line(0, `${enumName}<public> := enum{${fields.filter((f) => !isMetadata(f)).map((f) => f.name).join(", ")}}`);
      out.blank();
      out.line(0, `${snake(m.name)}<public> := class:`);
      out.line(1, `Changed<public>:event() = event(){}`);
      out.line(1, `FieldChanged<public>:event(${enumName}) = event(${enumName}){}`);
      out.line(1, `SaveBlocked<public>:event(prism_block) = event(prism_block){}`);
      out.line(1, `var<private> Dirty<public>:logic = false`);
      out.line(1, `var<private> ReadOnly<public>:logic = false`);
      out.line(1, `var<private> OfflineSeconds<public>:float = 0.0`);
      out.line(1, `var HasRecord<internal>:logic = false`);
      out.line(1, `var NextWriteAt<internal>:float = 0.0`);
      out.line(1, `var NextCheckAt<internal>:float = 0.0`);
      out.line(1, `var CommitPending<private>:logic = false`);
      out.line(1, `var Touched<private>:[]${enumName} = array{}`);
      out.blank();
      for (const f of fields) out.line(1, `var<private> ${f.name}<public>:${this.verseType(f.type)} = ${this.initialValue(f)}`);
      for (const f of fields) this.mutators(out, f, members, enumName);
      this.modelPlumbing(out, m, members, enumName);
    }
    return out.toString();
  }

  stores(): string {
    const out = this.header(true);
    for (const m of this.schema.models) {
      const model = snake(m.name);
      const live = `${m.name}Live`;
      out.blank();
      out.line(0, `var ${live}<internal>:weak_map(session, [player]${model}) = map{}`);
      out.blank();
      out.line(0, `(Who:player).Get${m.name}<public>()<reads><decides>:${model} = ${live}[GetSession()][Who]`);
      out.blank();
      out.line(0, `${m.name}Store<public>:${model}_store = ${model}_store{}`);
      out.blank();
      this.storeClass(out, m);
      this.migrated(out, m);
      for (const f of m.fields) this.rowsOf(out, m, f);
    }
    for (const t of this.schema.types) this.validated(out, t);
    for (const d of this.decls()) if (d.kind === "model" || recordFixed(d) === undefined) this.sizeOf(out, d);
    return out.toString();
  }

  // ---- records ----

  private decls(): (ModelDecl | TypeDecl)[] {
    return [...this.schema.models, ...this.schema.types];
  }

  private maker(d: ModelDecl | TypeDecl): string {
    return `Make${pascal(d.recordClass)}`;
  }

  // A copy of `source` with some fields replaced: [persisted name, expression].
  private copy(out: Lines, depth: number, d: ModelDecl | TypeDecl, source: string, overrides: [string, string][]): void {
    const replaced = new Map(overrides);
    if (this.schema.settings.copy === "constructor") {
      const parts = overrides.map(([k, v]) => `${k} := ${v}`);
      parts.push(`${this.maker(d)}<constructor>(${source})`);
      out.line(depth, `${d.recordClass}{${parts.join(", ")}}`);
      return;
    }
    out.line(depth, `${d.recordClass}:`);
    for (const f of this.savedFields(d)) out.line(depth + 1, `${f.name} := ${replaced.get(f.name) ?? `${source}.${f.name}`}`);
  }

  // The fields of a record class: a model's saved shape (lists of flat types become columns), a type's own fields.
  private savedFields(d: ModelDecl | TypeDecl): { name: string; type: string; default: string }[] {
    if (d.kind === "model") return shapeFields(this.schema, d);
    return persistedFields(d).map((f) => ({ name: f.persisted, type: this.verseType(f.type), default: this.persistedDefault(f) }));
  }

  private storeType(m: ModelDecl): string {
    return this.schema.settings.kind === "player" ? `weak_map(player, ${m.recordClass})` : `weak_map(session, [player]${m.recordClass})`;
  }

  // ---- model ----

  private members(m: ModelDecl): Set<string> {
    const taken = new Set<string>([...MODEL_MEMBERS, ...(this.options.reserved ?? [])]);
    for (const f of m.fields.filter(inModel)) {
      taken.add(f.name);
      for (const n of memberNames(f, this.prefix)) taken.add(n);
    }
    return taken;
  }

  private mutators(out: Lines, f: Field, members: Set<string>, enumName: string): void {
    if (isMetadata(f)) return;
    const p = this.prefix;
    const n = f.name;
    const t = this.verseType(f.type);
    const touch = `Touch(${enumName}.${n}, ${f.transient ? "false" : "true"})`;
    const value = fresh("Value", members);
    out.blank();
    if (f.type.container === "list") {
      this.listMutators(out, f, members, touch);
      return;
    }
    const isInt = f.type.container === "none" && f.type.base.kind === "scalar" && f.type.base.name === "Int";
    const clamped = this.clamp(f, value);
    out.line(1, `${p}Set${n}<public>(${value}:${t})<transacts>:void =`);
    out.line(2, `set ${n} = ${isInt && !(f.min && f.max) ? `PrismInt64(${clamped})` : clamped}`);
    out.line(2, touch);
    if (isNumeric(f.type) && !f.counter) {
      const delta = fresh("Delta", members);
      out.blank();
      out.line(1, `${p}Add${n}<public>(${delta}:${t})<transacts>:void = ${p}Set${n}(${n} + ${delta})`);
    }
    if (f.type.container === "none" && f.type.base.kind === "scalar" && f.type.base.name === "Bool") {
      out.blank();
      out.line(1, `${p}Toggle${n}<public>()<transacts>:void = ${p}Set${n}(if (${n}?) then false else true)`);
    }
    if (f.counter) {
      const taken = fresh("Taken", members);
      out.blank();
      out.line(1, `${p}Take${n}<public>()<transacts>:int =`);
      out.line(2, `${taken} := ${n}`);
      out.line(2, `${p}Set${n}(${taken} + 1)`);
      out.line(2, taken);
    }
  }

  private listMutators(out: Lines, f: Field, members: Set<string>, touch: string): void {
    const p = this.prefix;
    const n = f.name;
    const item = f.item;
    const itemType = this.verseType({ base: f.type.base, container: "none" });
    const value = fresh("Value", members);
    const index = fresh("Index", members);
    const updated = fresh("Updated", members);
    const max = f.maxItems ? literalText(f.maxItems) : undefined;
    const effects = max ? "<transacts><decides>" : "<transacts>";
    out.line(1, `${p}Set${n}<public>(${value}:[]${itemType})<transacts>:void =`);
    out.line(2, `set ${n} = ${max ? `${value}.${keepFn(f)}(${max})` : value}`);
    out.line(2, touch);
    const id = isIdList(f);
    if (id) {
      const key = idField(id)!.name;
      const idName = fresh("Id", members);
      const found = fresh("Found", members);
      const replaced = fresh("Replaced", members);
      const at = fresh("At", members);
      out.blank();
      out.line(1, `${p}Find${item}<public>(${idName}:int)<reads><decides>:${itemType} =`);
      out.line(2, `first(${found} : ${n}, ${found}.${key} = ${idName}). ${found}`);
      out.blank();
      out.line(1, `${p}Upsert${item}<public>(${value}:${itemType})${effects}:void =`);
      out.line(2, `${updated} := if (${index} := first(${at} -> ${found} : ${n}, ${found}.${key} = ${value}.${key}). ${at}, ${replaced} := ${n}.ReplaceElement[${index}, ${value}]) then ${replaced} else ${n} + array{${value}}`);
      if (max) out.line(2, `${updated}.Length <= ${max}`);
      out.line(2, `set ${n} = ${updated}`);
      out.line(2, touch);
      out.blank();
      out.line(1, `${p}Delete${item}<public>(${idName}:int)<transacts><decides>:void =`);
      out.line(2, `${index} := first(${at} -> ${found} : ${n}, ${found}.${key} = ${idName}). ${at}`);
      out.line(2, `${updated} := ${n}.RemoveElement[${index}]`);
      out.line(2, `set ${n} = ${updated}`);
      out.line(2, touch);
      return;
    }
    // A capped history (@trim(head)) drops its oldest item instead of refusing a new one.
    const rolling = max !== undefined && f.trim?.end === "head";
    out.blank();
    out.line(1, `${p}Push${item}<public>(${value}:${itemType})${rolling ? "<transacts>" : effects}:void =`);
    if (rolling) out.line(2, `set ${n} = (${n} + array{${value}}).PrismKeepLast(${max})`);
    else {
      if (max) out.line(2, `${n}.Length < ${max}`);
      out.line(2, `set ${n} += array{${value}}`);
    }
    out.line(2, touch);
    out.blank();
    out.line(1, `${p}Set${item}At<public>(${index}:int, ${value}:${itemType})<transacts><decides>:void =`);
    out.line(2, `${updated} := ${n}.ReplaceElement[${index}, ${value}]`);
    out.line(2, `set ${n} = ${updated}`);
    out.line(2, touch);
    out.blank();
    out.line(1, `${p}Delete${item}At<public>(${index}:int)<transacts><decides>:void =`);
    out.line(2, `${updated} := ${n}.RemoveElement[${index}]`);
    out.line(2, `set ${n} = ${updated}`);
    out.line(2, touch);
  }

  private modelPlumbing(out: Lines, m: ModelDecl, members: Set<string>, enumName: string): void {
    const field = fresh("Field", members);
    const fields = fresh("Fields", members);
    const saved = fresh("Saved", members);
    const rec = fresh("Rec", members);
    const now = fresh("Now", members);
    const version = m.fields.find((f) => f.version);
    const metadata = m.fields.filter(isMetadata);
    out.blank();
    out.line(1, `Commit<public>()<transacts>:void =`);
    out.line(2, `set CommitPending = true`);
    out.blank();
    out.line(1, `Notify<public>():void =`);
    out.line(2, `if (Touched.Length > 0):`);
    out.line(3, `${fields} := Touched`);
    out.line(3, `set Touched = array{}`);
    out.line(3, `for (${field} : ${fields}):`);
    out.line(4, `FieldChanged.Signal(${field})`);
    out.line(3, `Changed.Signal()`);
    out.blank();
    out.line(1, `Touch<private>(${field}:${enumName}, ${saved}:logic)<transacts>:void =`);
    out.line(2, `if (${saved}?):`);
    out.line(3, `set Dirty = true`);
    out.line(2, `if (not Touched.PrismContains[${field}]):`);
    out.line(3, `set Touched += array{${field}}`);
    out.blank();
    out.line(1, `TakeCommit<internal>()<transacts><decides>:void =`);
    out.line(2, `CommitPending?`);
    out.line(2, `set CommitPending = false`);
    out.blank();
    out.line(1, `MarkSaved<internal>(${rec}:${m.recordClass})<transacts>:void =`);
    out.line(2, `set Dirty = false`);
    out.line(2, `set HasRecord = true`);
    for (const f of metadata) out.line(2, `set ${f.name} = ${rec}.${f.persisted}`);
    out.blank();
    out.line(1, `LoadRecord<internal>(${rec}:${m.recordClass})<transacts>:void =`);
    out.line(2, `set HasRecord = true`);
    if (version) {
      out.line(2, `if (${rec}.${version.persisted} > ${m.version}):`);
      out.line(3, `set ReadOnly = true`);
    }
    const loaded = m.fields.filter((f) => inModel(f) && isPersisted(f));
    for (const f of loaded.filter((x) => !x.counter)) {
      if (isMetadata(f)) out.line(2, `set ${f.name} = ${rec}.${f.persisted}`);
      else out.line(2, `set ${f.name} = ${this.loadExpr(f, columnType(f) ? `${rec}.PrismRows${f.persisted}()` : `${rec}.${f.persisted}`, members)}`);
      if (f.lastSeen) out.line(2, `set OfflineSeconds = PrismOfflineSeconds(${rec}.${f.persisted})`);
    }
    for (const f of loaded.filter((x) => x.counter)) {
      const c = f.counter!;
      const item = fresh("Item", members);
      out.line(2, `set ${f.name} = Max(${rec}.${f.persisted}, (for (${item} : ${c.list.name}) { ${item}.${c.idField.name} }).PrismNextId())`);
    }
    out.blank();
    out.line(1, `ToRecord<internal>(${now}:float)<transacts>:${m.recordClass} =`);
    out.line(2, `${m.recordClass}:`);
    for (const f of persistedFields(m)) {
      if (f.deprecated) continue;
      if (f.version) out.line(3, `${f.persisted} := ${m.version}`);
      else if (f.lastSeen) out.line(3, `${f.persisted} := ${now}`);
      else if (f.firstSeen) out.line(3, `${f.persisted} := if (${f.name} > 0.0) then ${f.name} else ${now}`);
      else if (f.saveCount) out.line(3, `${f.persisted} := ${f.name} + 1`);
      else if (columnType(f)) {
        const item = fresh("Item", members);
        for (const c of columnType(f)!.fields) out.line(3, `${columnName(f, c)} := for (${item} : ${f.name}) { ${item}.${c.persisted} }`);
      } else out.line(3, `${f.persisted} := ${f.name}`);
    }
    out.blank();
    out.line(1, `Clear<internal>()<transacts>:void =`);
    for (const f of m.fields.filter((x) => inModel(x) && !isMetadata(x))) out.line(2, `${this.prefix}Set${f.name}(${this.initialValue(f)})`);
    out.line(2, `set OfflineSeconds = 0.0`);
  }

  private clamp(f: Field, v: string): string {
    if (f.min && f.max) return `Clamp(${v}, ${this.bound(f, f.min)}, ${this.bound(f, f.max)})`;
    if (f.min) return `Max(${v}, ${this.bound(f, f.min)})`;
    if (f.max) return `Min(${v}, ${this.bound(f, f.max)})`;
    return v;
  }

  private bound(f: Field, lit: Literal): string {
    return this.value(lit, { base: f.type.base, container: "none" });
  }

  private loadExpr(f: Field, src: string, members: ReadonlySet<string>): string {
    const t = f.type;
    if (t.container === "list") {
      const item = fresh("Item", members);
      let itemExpr = item;
      if (t.base.kind === "record" && this.needsValidation(t.base.decl)) itemExpr = `${item}.PrismValidated()`;
      else if (f.valid) itemExpr = `(if (${f.valid.fn}[${item}]) then ${item} else ${this.value(f.valid.fallback!, { base: t.base, container: "none" })})`;
      let expr = src;
      if (f.where || itemExpr !== item) expr = `for (${item} : ${src}${f.where ? `, ${f.where}[${item}]` : ""}) { ${itemExpr} }`;
      if (f.maxItems) expr = `${expr === src ? src : `(${expr})`}.${keepFn(f)}(${literalText(f.maxItems)})`;
      return expr;
    }
    if (t.container === "option") {
      const inner = fresh("Inner", members);
      const validate = t.base.kind === "record" && this.needsValidation(t.base.decl) ? `${inner}.PrismValidated()` : inner;
      if (f.valid) return `if (${inner} := ${src}?, ${f.valid.fn}[${inner}]) then option{${validate}} else ${this.persistedDefault(f)}`;
      if (validate !== inner) return `if (${inner} := ${src}?) then option{${validate}} else false`;
      return src;
    }
    let v = t.base.kind === "record" && this.needsValidation(t.base.decl) ? `${src}.PrismValidated()` : src;
    if (f.valid) {
      const fallback = f.valid.fallback ? this.value(f.valid.fallback, t) : this.persistedDefault(f);
      v = `if (${f.valid.fn}[${src}]) then ${v} else ${fallback}`;
      return f.min || f.max ? this.clamp(f, `(${v})`) : v;
    }
    return this.clamp(f, v);
  }

  // ---- store ----

  private storeClass(out: Lines, m: ModelDecl): void {
    const model = snake(m.name);
    const live = `${m.name}Live`;
    const memory = this.schema.settings.kind === "memory";
    const lists = trimmedLists(m);
    const record = m.recordClass;
    out.line(0, `${model}_store<public> := class<final><computes>(prism_store):`);
    out.line(1, `StoreName<override>()<computes>:string = "${m.name}"`);
    out.blank();
    out.line(1, `Acquire<public>(Who:player):${model} =`);
    out.line(2, `if (Live := Who.Get${m.name}[]):`);
    out.line(3, `Live`);
    out.line(2, `else:`);
    out.line(3, `Model := ${model}{}`);
    out.line(3, `if (Saved := Read[Who]):`);
    out.line(4, `Model.LoadRecord(${m.migrations.length > 0 ? "Saved.PrismMigrated()" : "Saved"})`);
    if (m.fields.some((f) => f.version)) {
      out.line(4, `if (Model.ReadOnly?):`);
      out.line(5, `PrismLog(StoreName(), "this save is newer than the code: it stays read-only for this player")`);
    }
    out.line(3, `Keep(Who, Model)`);
    if (m.onLoad) out.line(3, `${m.onLoad}(Who, Model)`);
    out.line(3, `Model`);
    out.blank();
    out.line(1, `Open<override>(Who:player):void =`);
    out.line(2, `Acquire(Who)`);
    out.blank();
    out.line(1, `Flush<override>(Who:player, Force:logic):void =`);
    out.line(2, `if (Model := Who.Get${m.name}[], not Model.ReadOnly?, Model.Dirty? or (Force? and Model.HasRecord?)):`);
    out.line(3, `Rec := Model.ToRecord(PrismNow())`);
    out.line(3, `Size := Rec.PrismSize()`);
    out.line(3, `Now := GetSimulationElapsedTime()`);
    out.line(3, `Checked:logic = if (Size > PrismPlayerMapBudget, Size <= PrismFitsCheckMax) then true else false`);
    out.line(3, `if (Checked?, Now < Model.NextCheckAt):`);
    out.line(4, `set Model.NextWriteAt = Max(Model.NextWriteAt, Model.NextCheckAt)`);
    out.line(3, `else:`);
    out.line(4, `if (Checked?):`);
    out.line(5, `set Model.NextCheckAt = Now + PrismLargeRecordSeconds`);
    out.line(4, `Fitted:?${record} = if (Size <= PrismPlayerMapBudget) then option{Rec} else Fit(Rec, Size)`);
    out.line(4, `if (Final := Fitted?):`);
    out.line(5, `Written := Write(Who, Final)`);
    out.line(5, `if (Written?):`);
    out.line(6, `Model.MarkSaved(Final)`);
    out.line(5, `else:`);
    out.line(6, `PrismLog(StoreName(), "write failed: the player is no longer a valid key")`);
    out.line(4, `else:`);
    out.line(5, `set Model.NextWriteAt = Now + PrismBlockedRetrySeconds`);
    out.line(5, `Model.SaveBlocked.Signal(prism_block.TooLarge)`);
    out.blank();
    out.line(1, `FlushNow<public>(Who:player):void =`);
    out.line(2, `Flush(Who, true)`);
    out.blank();
    out.line(1, `Close<override>(Who:player):void =`);
    out.line(2, `Flush(Who, false)`);
    out.line(2, `Drop(Who)`);
    out.blank();
    out.line(1, `FlushAll<override>(Force:logic):void =`);
    out.line(2, `if (Live := ${live}[GetSession()]):`);
    out.line(3, `for (Who -> Model : Live):`);
    out.line(4, `Flush(Who, Force)`);
    out.blank();
    out.line(1, `Pump<override>(Debounce:float):void =`);
    out.line(2, `if (Live := ${live}[GetSession()]):`);
    out.line(3, `Now := GetSimulationElapsedTime()`);
    out.line(3, `for (Who -> Model : Live):`);
    out.line(4, `if (Model.TakeCommit[]):`);
    out.line(5, `set Model.NextWriteAt = Now + Debounce`);
    out.line(5, `Flush(Who, true)`);
    out.line(4, `else if (Model.Dirty?, Now >= Model.NextWriteAt):`);
    out.line(5, `set Model.NextWriteAt = Now + Debounce`);
    out.line(5, `Flush(Who, false)`);
    out.line(4, `Model.Notify()`);
    out.blank();
    out.line(1, `Reset<public>(Who:player):void =`);
    out.line(2, `Model := Acquire(Who)`);
    out.line(2, `Model.Clear()`);
    out.line(2, `Flush(Who, true)`);
    out.blank();
    out.line(1, `Read<private>(Who:player)<transacts><decides>:${record} =`);
    out.line(2, memory ? `${m.storeVar}[GetSession()][Who]` : `${m.storeVar}[Who]`);
    out.blank();
    out.line(1, `Write<private>(Who:player, Rec:${record}):logic =`);
    if (memory) {
      out.line(2, `if (set ${m.storeVar}[GetSession()][Who] = Rec) then true`);
      out.line(2, `else if (set ${m.storeVar}[GetSession()] = map{Who => Rec}) then true`);
      out.line(2, `else false`);
    } else out.line(2, `if (set ${m.storeVar}[Who] = Rec) then true else false`);
    out.blank();
    out.line(1, `Keep<private>(Who:player, Model:${model})<transacts>:void =`);
    out.line(2, `if (set ${live}[GetSession()][Who] = Model) {}`);
    out.line(2, `else if (set ${live}[GetSession()] = map{Who => Model}) {}`);
    out.blank();
    out.line(1, `Drop<private>(Who:player)<transacts>:void =`);
    out.line(2, `if (Live := ${live}[GetSession()]):`);
    out.line(3, `var Kept:[player]${model} = map{}`);
    out.line(3, `for (Other -> Model : Live, Other <> Who):`);
    out.line(4, `set Kept = ConcatenateMaps(Kept, map{Other => Model})`);
    out.line(3, `if (set ${live}[GetSession()] = Kept) {}`);
    out.blank();
    // One FitsInPlayerMap at most, never on a huge record; then arithmetic trimming against PrismSize.
    out.line(1, `Fit<private>(Rec:${record}, Size:int):?${record} =`);
    out.line(2, `if (Size <= PrismFitsCheckMax):`);
    out.line(3, `if (FitsInPlayerMap[Rec]):`);
    out.line(4, `return option{Rec}`);
    let current = "Rec";
    lists.forEach((f, i) => {
      const step = `Trimmed${f.persisted}`;
      out.line(2, `${step} := Trim${f.persisted}(${current})`);
      out.line(2, `if (${step}?):`);
      out.line(3, `return ${step}`);
      if (i < lists.length - 1) {
        const next = `Without${f.persisted}`;
        out.line(2, `${next} := ${this.emptied(current, f)}`);
        current = next;
      }
    });
    out.line(2, `PrismLog(StoreName(), "save blocked: the record exceeds the player map limit, the last saved record is kept")`);
    out.line(2, `false`);
    for (const f of lists) {
      const name = f.persisted;
      const fromEnd = f.trim!.end === "head" ? "true" : "false";
      const term = sizeTerms(m).terms.find((t) => t.field === f);
      const keep = keepFn(f);
      out.blank();
      out.line(1, `Trim${name}<private>(Rec:${record}):?${record} =`);
      out.line(2, `Budget := PrismPlayerMapBudget - ${this.emptied("Rec", f)}.PrismSize()`);
      out.line(2, `if (Budget < 0):`);
      out.line(3, `return false`);
      if (term?.kind === "columns") {
        const count = `Rec.${term.first}.Length`;
        const strings = term.strings.map((c) => ` + (Rec.${c}[Index] or "").Length * ${COST.stringChar} + ${COST.stringBase + COST.item}`).join("");
        if (term.strings.length === 0) out.line(2, `KeepCount := if (Count := Quotient[Budget, ${term.rowBytes}]) then Count else 0`);
        else out.line(2, `KeepCount := PrismFitCount(for (Index := 0..${count} - 1) { ${term.rowBytes}${strings} }, Budget, ${fromEnd})`);
        const columns = columnType(f)!.fields.map((c) => columnName(f, c));
        out.line(2, `PrismLog(StoreName(), "${name} trimmed from {${count}} to {Min(KeepCount, ${count})} items to fit the player map")`);
        out.line(2, `option{Rec${columns.map((c) => `.With${c}(Rec.${c}.${keep}(KeepCount))`).join("")}}`);
        continue;
      }
      if (term?.kind === "fixedList") out.line(2, `KeepCount := if (Count := Quotient[Budget, ${term.itemBytes}]) then Count else 0`);
      else if (term?.kind === "stringList") out.line(2, `KeepCount := PrismFitCount(for (Item : Rec.${name}) { Item.Length * ${COST.stringChar} + ${COST.stringBase + COST.item} }, Budget, ${fromEnd})`);
      else out.line(2, `KeepCount := PrismFitCount(for (Item : Rec.${name}) { Item.PrismSize() + ${COST.item} }, Budget, ${fromEnd})`);
      out.line(2, `Kept := Rec.${name}.${keep}(KeepCount)`);
      out.line(2, `PrismLog(StoreName(), "${name} trimmed from {Rec.${name}.Length} to {Kept.Length} items to fit the player map")`);
      out.line(2, `option{Rec.With${name}(Kept)}`);
    }
  }

  // The record without the items of one list (all its columns emptied).
  private emptied(rec: string, f: Field): string {
    const columns = columnType(f);
    if (!columns) return `${rec}.With${f.persisted}(array{})`;
    return rec + columns.fields.map((c) => `.With${columnName(f, c)}(array{})`).join("");
  }

  // Rebuilds the items of a columnar list; a missing value (a column added later) takes the field's default.
  private rowsOf(out: Lines, m: ModelDecl, f: Field): void {
    const t = columnType(f);
    if (!t || !isPersisted(f) || f.deprecated) return;
    const lengths = t.fields.map((c) => `Rec.${columnName(f, c)}.Length`).join(", ");
    out.blank();
    out.line(0, `(Rec:${m.recordClass}).PrismRows${f.persisted}<internal>()<transacts>:[]${t.recordClass} =`);
    out.line(1, `for (Index := 0..PrismMaxLength(array{${lengths}}) - 1):`);
    out.line(2, `${t.recordClass}:`);
    for (const c of t.fields) out.line(3, `${c.persisted} := Rec.${columnName(f, c)}[Index] or ${this.persistedDefault(c)}`);
  }

  private migrated(out: Lines, m: ModelDecl): void {
    if (m.migrations.length === 0) return;
    const version = m.fields.find((f) => f.version)!.persisted;
    out.blank();
    out.line(0, `(Rec:${m.recordClass}).PrismMigrated<internal>()<transacts>:${m.recordClass} =`);
    out.line(1, `var Current:${m.recordClass} = Rec`);
    for (const step of m.migrations) {
      out.line(1, `if (Current.${version} < ${step.step}):`);
      out.line(2, `set Current = ${step.fn}(Current).With${version}(${step.step})`);
    }
    out.line(1, `Current`);
  }

  private validated(out: Lines, t: TypeDecl): void {
    if (!this.needsValidation(t)) return;
    const changed: [string, string][] = [];
    for (const f of t.fields) {
      const src = `Rec.${f.persisted}`;
      const expr = this.loadExpr(f, src, new Set(t.fields.map((x) => x.name)));
      if (expr !== src) changed.push([f.persisted, expr]);
    }
    out.blank();
    out.line(0, `(Rec:${t.recordClass}).PrismValidated<internal>()<transacts>:${t.recordClass} =`);
    if (this.schema.settings.copy === "constructor") {
      out.line(1, `${t.recordClass}:`);
      for (const [k, v] of changed) out.line(2, `${k} := ${v}`);
      out.line(2, `${this.maker(t)}<constructor>(Rec)`);
    } else this.copy(out, 1, t, "Rec", changed);
  }

  private needsValidation(t: TypeDecl, seen = new Set<string>()): boolean {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return t.fields.some(
      (f) => f.min || f.max || f.valid || f.where || f.maxItems || (f.type.base.kind === "record" && this.needsValidation(f.type.base.decl, seen)),
    );
  }

  // An upper bound of the serialized size, in bytes (cli/size.ts holds the costs).
  private sizeOf(out: Lines, d: ModelDecl | TypeDecl): void {
    const { constant, terms } = sizeTerms(d);
    const parts = [String(constant)];
    for (const t of terms) {
      const src = `Rec.${t.field.persisted}`;
      switch (t.kind) {
        case "fixedList":
          parts.push(`${src}.Length * ${t.itemBytes}`);
          break;
        case "stringList":
          parts.push(`PrismSum(for (Item : ${src}) { Item.Length * ${COST.stringChar} + ${COST.stringBase + COST.item} })`);
          break;
        case "recordList":
          parts.push(`PrismSum(for (Item : ${src}) { Item.PrismSize() + ${COST.item} })`);
          break;
        case "string":
          parts.push(`${src}.Length * ${COST.stringChar}`);
          break;
        case "optionString":
          parts.push(`(if (Inner := ${src}?) then Inner.Length * ${COST.stringChar} + ${COST.stringBase} else 0)`);
          break;
        case "optionRecord":
          parts.push(`(if (Inner := ${src}?) then Inner.PrismSize() else 0)`);
          break;
        case "record":
          parts.push(`${src}.PrismSize()`);
          break;
        case "columns":
          parts.push(`Rec.${t.first}.Length * ${t.rowBytes}`);
          for (const c of t.strings) parts.push(`PrismSum(for (Item : Rec.${c}) { Item.Length * ${COST.stringChar} + ${COST.stringBase + COST.item} })`);
          break;
      }
    }
    out.blank();
    out.line(0, `(Rec:${d.recordClass}).PrismSize<internal>()<transacts>:int =`);
    out.line(1, parts.join(" + "));
  }

  // ---- values and types ----

  verseType(t: FieldType): string {
    return text.verseType(t);
  }

  private persistedDefault(f: Field): string {
    return text.persistedDefault(this.schema, f);
  }

  private initialValue(f: Field): string {
    return text.initialValue(this.schema, f);
  }

  value(lit: Literal, t: FieldType): string {
    return text.value(this.schema, lit, t);
  }

  private header(runtime: boolean): Lines {
    const out = new Lines();
    out.line(0, `# Code generated by prism-verse ${VERSION} from ${this.options.schemaName} (sha256:${this.options.schemaHash}). DO NOT EDIT.`);
    out.line(0, `using { /Verse.org/Simulation }`);
    if (runtime) out.line(0, `using { ${this.options.lib} }`);
    for (const u of this.schema.settings.using) out.line(0, `using { ${u} }`);
    return out;
  }
}

function keepFn(f: Field): string {
  return f.trim?.end === "head" ? "PrismKeepLast" : "PrismKeepFirst";
}

function literalText(lit: Literal): string {
  return lit.kind === "name" ? lit.parts.join(".") : lit.kind === "int" ? lit.text : "";
}

export function verseTypeOf(_schema: Schema, t: FieldType): string {
  return text.verseType(t);
}

export function persistedDefaultOf(schema: Schema, f: Field): string {
  return text.persistedDefault(schema, f);
}
