import type { AttributeNode, BlockNode, Container, EnumNode, FieldNode, Literal, SchemaNode, SettingsNode } from "./ast.ts";
import type { Reporter } from "./diagnostics.ts";
import { closest, isBuiltin, isIdentifier, isReserved, singular, snake } from "./names.ts";
import type { CodeTable } from "./naming.ts";
import { PLAYER_MAP_LIMIT, worstCase } from "./size.ts";
import { parse } from "./parser.ts";
import type { SourceFile, Span } from "./source.ts";

export type Scalar = "Int" | "Float" | "Bool" | "String";
const SCALARS: readonly Scalar[] = ["Int", "Float", "Bool", "String"];

export type Base =
  | { kind: "scalar"; name: Scalar }
  | { kind: "enum"; decl: EnumDecl }
  | { kind: "record"; decl: TypeDecl };

export interface FieldType {
  base: Base;
  container: Container;
}

export interface Trim {
  end: "head" | "tail";
  priority: number;
}

export interface Field {
  name: string;
  persisted: string;
  mapped: boolean; // @map fixes the saved name
  type: FieldType;
  def: Literal | undefined;
  initial: Literal | undefined;
  min: Literal | undefined;
  max: Literal | undefined;
  maxItems: Literal | undefined;
  trim: Trim | undefined;
  where: string | undefined;
  valid: { fn: string; fallback: Literal | undefined } | undefined;
  id: boolean;
  counter: { list: Field; idField: Field } | undefined;
  item: string;
  version: boolean;
  lastSeen: boolean;
  firstSeen: boolean;
  saveCount: boolean;
  deprecated: boolean;
  owner: boolean; // declared in a model
  transient: boolean;
  node: FieldNode;
}

export interface TypeDecl {
  kind: "type";
  name: string;
  recordClass: string;
  fields: Field[];
  node: BlockNode;
  rows: boolean;
}

export interface Migration {
  step: number;
  fn: string;
  span: Span;
}

export interface ModelDecl {
  kind: "model";
  name: string;
  recordClass: string;
  fields: Field[];
  node: BlockNode;
  storeVar: string;
  onLoad: string | undefined;
  migrations: Migration[];
  version: number;
}

export interface EnumDecl {
  kind: "enum";
  name: string;
  verseName: string;
  values: string[];
  node: EnumNode;
}

export type StoreKind = "player" | "memory";

export interface Settings {
  kind: StoreKind;
  prefix: string;
  methodPrefix: string;
  lib: string | undefined;
  using: string[];
  copy: "constructor" | "explicit";
  names: "short" | "long";
}

export interface Schema {
  file: SourceFile;
  settings: Settings;
  models: ModelDecl[];
  types: TypeDecl[];
  enums: EnumDecl[];
  codes?: CodeTable; // saved names of the model records, set by the CLI from names.json and published shapes
}

export function loadSchema(file: SourceFile, reporter: Reporter, defaultPrefix: string): Schema {
  return new Analyzer(file, reporter).run(parse(file, reporter), defaultPrefix);
}

export function isPersisted(f: Field): boolean {
  return !f.transient;
}

export function inModel(f: Field): boolean {
  return !f.deprecated && !f.version;
}

// Written by Prism at each save, read-only in the model.
export function isMetadata(f: Field): boolean {
  return f.lastSeen || f.firstSeen || f.saveCount;
}

export function persistedFields(d: ModelDecl | TypeDecl): Field[] {
  return d.fields.filter(isPersisted);
}

export function isNumeric(t: FieldType): boolean {
  return t.container === "none" && t.base.kind === "scalar" && (t.base.name === "Int" || t.base.name === "Float");
}

export function isIdList(f: Field): TypeDecl | undefined {
  if (f.type.container !== "list" || f.type.base.kind !== "record") return undefined;
  return f.type.base.decl.fields.some((x) => x.id) ? f.type.base.decl : undefined;
}

// Every field is an Int, Float, Bool, String or enum: a list of it can be saved as one array per field.
export function columnEligible(t: TypeDecl): boolean {
  return t.fields.length > 0 && t.fields.every((f) => f.type.container === "none" && f.type.base.kind !== "record");
}

// Only a list held by a model: a nested type is both the saved object and the in-memory value, so it can't hold columns.
export function columnType(f: Field): TypeDecl | undefined {
  if (!f.owner || f.type.container !== "list" || f.type.base.kind !== "record") return undefined;
  const t = f.type.base.decl;
  return !t.rows && columnEligible(t) ? t : undefined;
}

// A single field of a flat type held by a model: its fields are saved as fields of the record (no object).
export function flatType(f: Field): TypeDecl | undefined {
  if (!f.owner || f.type.container !== "none" || f.type.base.kind !== "record") return undefined;
  const t = f.type.base.decl;
  return !t.rows && columnEligible(t) ? t : undefined;
}

export function idField(d: TypeDecl): Field | undefined {
  return d.fields.find((f) => f.id);
}

export function trimmedLists(m: ModelDecl): Field[] {
  return m.fields.filter((f) => f.trim && !f.transient).sort((a, b) => (a.trim!.priority - b.trim!.priority) || (m.fields.indexOf(a) - m.fields.indexOf(b)));
}

const FIELD_ATTRIBUTES = [
  "initial", "map", "min", "max", "maxItems", "trim", "where", "valid", "id", "counter", "item", "version",
  "lastSeen", "firstSeen", "saveCount", "deprecated", "transient",
];
const BLOCK_ATTRIBUTES = ["map", "store", "onLoad", "migrate", "rows"];

class Analyzer {
  private readonly file: SourceFile;
  private readonly reporter: Reporter;
  private readonly types = new Map<string, TypeDecl>();
  private readonly models = new Map<string, ModelDecl>();
  private readonly enums = new Map<string, EnumDecl>();

  constructor(file: SourceFile, reporter: Reporter) {
    this.file = file;
    this.reporter = reporter;
  }

  run(ast: SchemaNode, defaultPrefix: string): Schema {
    const settings = this.settings(ast.settings, defaultPrefix);
    this.declareAll(ast);
    for (const e of this.enums.values()) this.checkEnum(e);
    for (const d of [...this.types.values(), ...this.models.values()]) this.resolveBlock(d, settings);
    for (const d of [...this.types.values(), ...this.models.values()]) this.resolveCounters(d);
    this.checkCycles();
    this.checkModuleNames();
    const persistent = [...this.models.values()];
    if (settings.kind === "player" && persistent.length > 4) {
      const fifth = persistent[4]!;
      this.error("P025", `${persistent.length} persistent stores: UEFN allows 4 persistent maps per island`, fifth.node.name.span, {
        help: "merge models, or move this one to a `type` inside another model",
      });
    }
    for (const m of persistent) this.checkMembers(m, settings);
    if (!this.reporter.hasErrors) {
      this.checkColumns();
      for (const m of persistent) this.checkSize(m);
    }
    return { file: this.file, settings, models: persistent, types: [...this.types.values()], enums: [...this.enums.values()] };
  }

  private settings(nodes: SettingsNode[], defaultPrefix: string): Settings {
    const s: Settings = { kind: "player", prefix: defaultPrefix, methodPrefix: "", lib: undefined, using: [], copy: "constructor", names: "short" };
    const seen = new Set<string>();
    for (const node of nodes) {
      if (seen.has(node.keyword)) this.error("P010", `\`${node.keyword}\` is declared twice`, node.span);
      seen.add(node.keyword);
      const allowed = node.keyword === "datasource" ? ["kind"] : ["prefix", "methodPrefix", "lib", "using", "copy", "names"];
      for (const { key, value } of node.entries) {
        if (!allowed.includes(key.text)) {
          const hint = closest(key.text, allowed);
          this.error("P005", `unknown ${node.keyword} setting \`${key.text}\``, key.span, hint ? { help: `did you mean \`${hint}\`?` } : { help: `expected ${allowed.map((a) => `\`${a}\``).join(", ")}` });
          continue;
        }
        if (key.text === "using") {
          if (value.kind !== "list" || value.items.some((i) => i.kind !== "string")) {
            this.error("P006", "`using` is a list of module paths", value.span, { help: 'e.g. `using = ["Balance", "Core.Rules"]`' });
          } else s.using = value.items.map((i) => (i.kind === "string" ? i.value : ""));
          continue;
        }
        if (value.kind !== "string") {
          this.error("P006", `\`${key.text}\` takes a string`, value.span);
          continue;
        }
        const v = value.value;
        if (key.text === "kind") {
          if (v === "player" || v === "memory") s.kind = v;
          else this.error("P006", `\`kind\` must be "player" or "memory", not "${v}"`, value.span);
        } else if (key.text === "prefix") {
          if (/^[a-z][a-z0-9_]*$/.test(v)) s.prefix = v;
          else this.error("P006", "`prefix` is a lower_snake_case file name prefix", value.span);
        } else if (key.text === "methodPrefix") {
          if (v === "" || isIdentifier(v)) s.methodPrefix = v;
          else this.error("P006", "`methodPrefix` must be a Verse identifier", value.span);
        } else if (key.text === "lib") {
          if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(v) || v.startsWith("/")) s.lib = v;
          else this.error("P006", "`lib` is a module path such as \"Lib.Prism\"", value.span);
        } else if (key.text === "names") {
          if (v === "short" || v === "long") s.names = v;
          else this.error("P006", '`names` is "short" (saved names of one or two characters) or "long" (the field names)', value.span);
        } else if (key.text === "copy") {
          if (v === "constructor" || v === "explicit") s.copy = v;
          else this.error("P006", '`copy` is "constructor" or "explicit"', value.span);
        }
      }
    }
    return s;
  }

  private declareAll(ast: SchemaNode): void {
    const taken = new Map<string, Span>();
    const claim = (name: string, span: Span): boolean => {
      this.checkIdentifier(name, span);
      if (SCALARS.includes(name as Scalar)) {
        this.error("P028", `\`${name}\` is a built-in type name`, span);
        return false;
      }
      if (taken.has(name)) {
        this.error("P010", `\`${name}\` is declared twice`, span);
        return false;
      }
      taken.set(name, span);
      return true;
    };
    for (const e of ast.enums) {
      if (claim(e.name.text, e.name.span)) {
        this.enums.set(e.name.text, { kind: "enum", name: e.name.text, verseName: snake(e.name.text), values: e.values.map((v) => v.text), node: e });
      }
    }
    for (const b of ast.blocks) {
      if (!claim(b.name.text, b.name.span)) continue;
      const mapped = this.blockString(b, "map");
      if (b.keyword === "type") {
        this.types.set(b.name.text, { kind: "type", name: b.name.text, recordClass: mapped ?? snake(b.name.text), fields: [], node: b, rows: b.attributes.some((a) => a.name.text === "rows") });
      } else {
        this.models.set(b.name.text, {
          kind: "model",
          name: b.name.text,
          recordClass: mapped ?? `${snake(b.name.text)}_record`,
          fields: [],
          node: b,
          storeVar: this.blockString(b, "store") ?? `${b.name.text}Saves`,
          onLoad: undefined,
          migrations: [],
          version: 1,
        });
      }
    }
  }

  private blockString(b: BlockNode, name: string): string | undefined {
    const a = b.attributes.find((x) => x.name.text === name);
    const arg = a?.args[0];
    return arg && arg.kind === "string" && a?.args.length === 1 ? arg.value : undefined;
  }

  private checkEnum(e: EnumDecl): void {
    if (e.values.length === 0) this.error("P027", `enum \`${e.name}\` has no values`, e.node.name.span);
    const seen = new Set<string>();
    for (const v of e.node.values) {
      this.checkIdentifier(v.text, v.span);
      if (seen.has(v.text)) this.error("P027", `enum value \`${v.text}\` is listed twice`, v.span);
      seen.add(v.text);
    }
  }

  private resolveBlock(d: ModelDecl | TypeDecl, settings: Settings): void {
    const seen = new Set<string>();
    for (const node of d.node.fields) {
      this.checkIdentifier(node.name.text, node.name.span);
      if (seen.has(node.name.text)) {
        this.error("P011", `field \`${node.name.text}\` is declared twice in \`${d.name}\``, node.name.span);
        continue;
      }
      seen.add(node.name.text);
      const f = this.resolveField(d, node);
      if (f) d.fields.push(f);
    }
    this.blockAttributes(d, settings);
    this.checkBlockRules(d);
  }

  private resolveField(d: ModelDecl | TypeDecl, node: FieldNode): Field | undefined {
    const type = this.resolveType(node);
    if (!type) return undefined;
    const f: Field = {
      name: node.name.text,
      persisted: node.name.text,
      mapped: false,
      type,
      def: node.default,
      initial: undefined,
      min: undefined,
      max: undefined,
      maxItems: undefined,
      trim: undefined,
      where: undefined,
      valid: undefined,
      id: false,
      counter: undefined,
      item: type.container === "list" ? singular(node.name.text) : node.name.text,
      version: false,
      lastSeen: false,
      firstSeen: false,
      saveCount: false,
      deprecated: false,
      owner: d.kind === "model",
      transient: false,
      node,
    };
    const seen = new Set<string>();
    for (const a of node.attributes) {
      const name = a.name.text;
      if (!FIELD_ATTRIBUTES.includes(name)) {
        const hint = closest(name, [...FIELD_ATTRIBUTES, ...BLOCK_ATTRIBUTES]);
        const blockOnly = BLOCK_ATTRIBUTES.includes(name) && !FIELD_ATTRIBUTES.includes(name);
        this.error("P013", `unknown field attribute \`@${name}\``, a.name.span, {
          help: blockOnly ? `\`@@${name}\` is a block attribute: put it on its own line at the end of the block` : hint ? `did you mean \`@${hint}\`?` : undefined,
        });
        continue;
      }
      if (seen.has(name)) {
        this.error("P016", `\`@${name}\` is given twice`, a.name.span);
        continue;
      }
      seen.add(name);
      this.fieldAttribute(d, f, a);
    }
    this.checkLiteral(f, f.def, "default");
    if (f.initial) this.checkLiteral(f, f.initial, "@initial");
    if (f.def && f.type.container === "none" && f.type.base.kind === "record") {
      this.error("P017", "a record field takes no default: it starts with every field of the record at its default", f.def.span);
    }
    return f;
  }

  private resolveType(node: FieldNode): FieldType | undefined {
    const t = node.type;
    if (t.nested) {
      this.error("P029", "nested containers are not supported", t.span, { help: "wrap the inner level in a `type`" });
      return undefined;
    }
    const name = t.name.text;
    let base: Base | undefined;
    if (SCALARS.includes(name as Scalar)) base = { kind: "scalar", name: name as Scalar };
    else if (this.enums.has(name)) base = { kind: "enum", decl: this.enums.get(name)! };
    else if (this.types.has(name)) base = { kind: "record", decl: this.types.get(name)! };
    else if (this.models.has(name)) {
      this.error("P030", `\`${name}\` is a model: a model is a root and can't be a field type`, t.name.span, {
        help: `declare it as \`type ${name}\` to embed it`,
      });
      return undefined;
    } else {
      const hint = closest(name, [...SCALARS, ...this.enums.keys(), ...this.types.keys()]);
      const help = hint ? `did you mean \`${hint}\`?` : name === "Boolean" || name === "logic" ? "use `Bool`" : name === "int" || name === "float" || name === "string" ? `types are capitalized: \`${name[0]!.toUpperCase()}${name.slice(1)}\`` : undefined;
      this.error("P012", `unknown type \`${name}\``, t.name.span, { label: "no model, type or enum has this name", help });
      return undefined;
    }
    return { base, container: t.container };
  }

  private fieldAttribute(d: ModelDecl | TypeDecl, f: Field, a: AttributeNode): void {
    const name = a.name.text;
    const span = a.span;
    const isList = f.type.container === "list";
    const scalarNumber = isNumeric(f.type);
    const onlyIn = (kind: "model" | "type"): boolean => {
      if (d.kind === kind) return true;
      this.error("P014", `\`@${name}\` is only allowed in a ${kind}`, span);
      return false;
    };
    const arity = (n: number, m = n): boolean => {
      if (a.args.length >= n && a.args.length <= m) return true;
      this.error("P015", `\`@${name}\` takes ${n === m ? n : `${n} or ${m}`} argument${m === 1 ? "" : "s"}`, span);
      return false;
    };
    switch (name) {
      case "initial":
        if (arity(1)) f.initial = a.args[0];
        break;
      case "map": {
        if (!arity(1)) break;
        const arg = a.args[0]!;
        if (arg.kind !== "string" || !isIdentifier(arg.value) || isReserved(arg.value)) this.error("P015", "`@map` takes the saved field name as a string", arg.span, { help: '`@map("Money")`' });
        else {
          f.persisted = arg.value;
          f.mapped = true;
        }
        break;
      }
      case "min":
      case "max": {
        if (!arity(1)) break;
        if (!scalarNumber) {
          this.error("P014", `\`@${name}\` applies to \`Int\` and \`Float\` fields`, span);
          break;
        }
        const arg = a.args[0]!;
        if (!this.numberFits(f, arg)) break;
        if (name === "min") f.min = arg;
        else f.max = arg;
        break;
      }
      case "maxItems": {
        if (!arity(1)) break;
        if (!isList) {
          this.error("P014", "`@maxItems` applies to lists", span);
          break;
        }
        const arg = a.args[0]!;
        if (arg.kind === "int" && Number(arg.text) >= 0) f.maxItems = arg;
        else if (arg.kind === "name") f.maxItems = arg;
        else this.error("P015", "`@maxItems` takes a non-negative integer or a constant name", arg.span);
        break;
      }
      case "trim": {
        if (!arity(1, 2)) break;
        if (!isList) {
          this.error("P014", "`@trim` applies to lists", span);
          break;
        }
        if (d.kind !== "model") {
          this.error("P014", "`@trim` applies to lists of a model", span);
          break;
        }
        const end = a.args[0]!;
        const prio = a.args[1];
        if (end.kind !== "name" || end.parts.length !== 1 || (end.parts[0] !== "head" && end.parts[0] !== "tail")) {
          this.error("P015", "`@trim` drops items from the `head` or the `tail`", end.span, { help: "`@trim(head)` drops the oldest items of a list that grows at the end" });
          break;
        }
        if (prio && (prio.kind !== "int" || Number(prio.text) < 1)) {
          this.error("P015", "the `@trim` priority is an integer from 1", prio.span);
          break;
        }
        f.trim = { end: end.parts[0] as "head" | "tail", priority: prio ? Number((prio as { text: string }).text) : 1 };
        break;
      }
      case "where": {
        if (!arity(1)) break;
        if (!isList) {
          this.error("P014", "`@where` filters lists; use `@valid` on a single value", span);
          break;
        }
        const fn = this.functionName(a.args[0]!);
        if (fn) f.where = fn;
        break;
      }
      case "valid": {
        if (!arity(1, 2)) break;
        if (isList && f.type.base.kind === "record") {
          this.error("P014", "`@valid` replaces scalar values; filter a list of records with `@where`", span);
          break;
        }
        const fn = this.functionName(a.args[0]!);
        if (!fn) break;
        const fallback = a.args[1];
        if (isList && !fallback) {
          this.error("P015", "`@valid` on a list needs a fallback value for the rejected items", span, { help: `\`@valid(${fn}, -1)\`` });
          break;
        }
        f.valid = { fn, fallback };
        break;
      }
      case "id":
        if (!arity(0) || !onlyIn("type")) break;
        if (f.type.container !== "none" || f.type.base.kind !== "scalar" || f.type.base.name !== "Int") this.error("P022", "`@id` must be an `Int` field", span);
        else f.id = true;
        break;
      case "counter": {
        if (!arity(1)) break;
        if (f.type.container !== "none" || f.type.base.kind !== "scalar" || f.type.base.name !== "Int") {
          this.error("P023", "`@counter` must be an `Int` field", span);
          break;
        }
        const arg = a.args[0]!;
        if (arg.kind !== "name" || arg.parts.length !== 2) {
          this.error("P023", "`@counter` names a list and its id field", arg.span, { help: "`@counter(Mines.Id)`" });
          break;
        }
        // Resolved once every field of the block is known.
        f.counter = { list: f, idField: f };
        break;
      }
      case "item": {
        if (!arity(1)) break;
        const arg = a.args[0]!;
        if (!isList) this.error("P014", "`@item` names the items of a list", span);
        else if (arg.kind !== "string" || !isIdentifier(arg.value)) this.error("P015", "`@item` takes the singular name as a string", arg.span, { help: '`@item("Mine")`' });
        else f.item = arg.value;
        break;
      }
      case "version":
        if (!arity(0) || !onlyIn("model")) break;
        if (f.type.container !== "none" || f.type.base.kind !== "scalar" || f.type.base.name !== "Int") this.error("P020", "`@version` must be an `Int` field", span);
        else if (!f.def) this.error("P020", "`@version` needs a default: the version of saves written before the field existed", span, { help: "`Version Int = 1 @version`" });
        else f.version = true;
        break;
      case "lastSeen":
      case "firstSeen":
        if (!arity(0) || !onlyIn("model")) break;
        if (f.type.container !== "none" || f.type.base.kind !== "scalar" || f.type.base.name !== "Float") this.error("P021", `\`@${name}\` must be a \`Float\` field`, span);
        else if (name === "lastSeen") f.lastSeen = true;
        else f.firstSeen = true;
        break;
      case "saveCount":
        if (!arity(0) || !onlyIn("model")) break;
        if (f.type.container !== "none" || f.type.base.kind !== "scalar" || f.type.base.name !== "Int") this.error("P021", "`@saveCount` must be an `Int` field", span);
        else f.saveCount = true;
        break;
      case "deprecated":
        if (arity(0)) f.deprecated = true;
        break;
      case "transient":
        if (arity(0) && onlyIn("model")) f.transient = true;
        break;
    }
  }

  private functionName(arg: Literal): string | undefined {
    if (arg.kind === "name") return arg.parts.join(".");
    this.error("P015", "expected the name of a Verse function", arg.span, { help: "validators are functions of your game: `(It:T)<computes><decides>:void`" });
    return undefined;
  }

  private numberFits(f: Field, arg: Literal): boolean {
    if (arg.kind === "name") return true;
    const base = f.type.base;
    if (base.kind === "scalar" && base.name === "Int" && arg.kind === "int") return true;
    if (base.kind === "scalar" && base.name === "Float" && (arg.kind === "float" || arg.kind === "int")) return true;
    this.error("P015", `expected ${base.kind === "scalar" && base.name === "Int" ? "an integer" : "a number"} or a constant name`, arg.span);
    return false;
  }

  private checkLiteral(f: Field, lit: Literal | undefined, what: string): void {
    if (!lit) return;
    const problem = literalProblem(f.type, lit);
    if (problem) this.error("P017", `${what} doesn't match \`${typeName(f.type)}\`: ${problem}`, lit.span);
  }

  private blockAttributes(d: ModelDecl | TypeDecl, settings: Settings): void {
    void settings;
    const seen = new Set<string>();
    for (const a of d.node.attributes) {
      const name = a.name.text;
      if (!BLOCK_ATTRIBUTES.includes(name)) {
        const hint = closest(name, BLOCK_ATTRIBUTES);
        this.error("P013", `unknown block attribute \`@@${name}\``, a.name.span, hint ? { help: `did you mean \`@@${hint}\`?` } : {});
        continue;
      }
      if (seen.has(name) && name !== "migrate") {
        this.error("P016", `\`@@${name}\` is given twice`, a.name.span);
        continue;
      }
      seen.add(name);
      if (name === "rows") {
        if (d.kind !== "type") this.error("P014", "`@@rows` is only allowed in a type", a.span);
        else if (a.args.length > 0) this.error("P015", "`@@rows` takes no argument", a.span);
        continue;
      }
      if (name !== "map" && d.kind !== "model") {
        this.error("P014", `\`@@${name}\` is only allowed in a model`, a.span);
        continue;
      }
      const first = a.args[0];
      switch (name) {
        case "map":
        case "store":
          if (a.args.length !== 1 || first?.kind !== "string" || !isIdentifier(first.value) || isReserved(first.value)) {
            this.error("P015", `\`@@${name}\` takes a Verse name as a string`, a.span, { help: name === "map" ? '`@@map("player_saved")`' : '`@@store("SaveStore")`' });
          }
          break;
        case "onLoad": {
          if (a.args.length !== 1 || first?.kind !== "name") {
            this.error("P015", "`@@onLoad` takes the name of a Verse function", a.span, { help: "`@@onLoad(AfterLoad)` with `AfterLoad(Who:player, Model:...):void`" });
            break;
          }
          (d as ModelDecl).onLoad = first.parts.join(".");
          break;
        }
        case "migrate": {
          const fn = a.args[1];
          if (a.args.length !== 2 || first?.kind !== "int" || fn?.kind !== "name") {
            this.error("P015", "`@@migrate` takes a version step and the name of a Verse function", a.span, { help: "`@@migrate(2, MoneyToFloat)`" });
            break;
          }
          const step = Number(first.text);
          const m = d as ModelDecl;
          if (step < 2) this.error("P024", "migration steps start at 2: version 1 is the first published shape", first.span);
          else if (m.migrations.some((x) => x.step === step)) this.error("P024", `migration step ${step} is declared twice`, first.span);
          else m.migrations.push({ step, fn: fn.parts.join("."), span: a.span });
          break;
        }
      }
    }
    if (d.kind === "model") {
      d.migrations.sort((x, y) => x.step - y.step);
      d.version = d.migrations.reduce((v, m) => Math.max(v, m.step), 1);
    }
  }

  private checkBlockRules(d: ModelDecl | TypeDecl): void {
    const persistedNames = new Map<string, Field>();
    let versionField: Field | undefined;
    const metadata = new Map<string, Field>();
    let idFieldSeen: Field | undefined;
    for (const f of d.fields) {
      const at = f.node.name.span;
      const conflict = (a: string, b: string): void => this.error("P018", `\`@${a}\` and \`@${b}\` can't be combined`, at);
      if (f.transient && f.mapped) conflict("transient", "map");
      if (f.transient && f.deprecated) conflict("transient", "deprecated");
      if (f.transient && f.version) conflict("transient", "version");
      if (f.transient && f.lastSeen) conflict("transient", "lastSeen");
      if (f.deprecated && f.initial) conflict("deprecated", "initial");
      if (f.deprecated && f.counter) conflict("deprecated", "counter");
      if (f.deprecated && f.id) conflict("deprecated", "id");
      if (f.version && f.initial) conflict("version", "initial");
      if (f.lastSeen && f.initial) conflict("lastSeen", "initial");
      if (f.min && f.max && f.min.kind !== "name" && f.max.kind !== "name") {
        const lo = Number((f.min as { text: string }).text);
        const hi = Number((f.max as { text: string }).text);
        if (lo > hi) this.error("P031", `\`@min(${lo})\` is greater than \`@max(${hi})\``, f.min.span);
      }
      if (f.valid?.fallback) {
        const itemType: FieldType = { base: f.type.base, container: f.type.container === "option" ? "option" : "none" };
        const problem = literalProblem(itemType, f.valid.fallback);
        if (problem) this.error("P032", `the \`@valid\` fallback doesn't match \`${typeName(itemType)}\`: ${problem}`, f.valid.fallback.span);
      }
      if (!f.transient) {
        const other = persistedNames.get(f.persisted);
        if (other) {
          this.error("P019", `\`${f.name}\` and \`${other.name}\` are both saved as \`${f.persisted}\``, at, { help: "give one of them another `@map` name" });
        }
        persistedNames.set(f.persisted, f);
      }
      if (f.version) {
        if (versionField) this.error("P020", "a model has at most one `@version` field", at);
        versionField = f;
      }
      for (const kind of ["lastSeen", "firstSeen", "saveCount"] as const) {
        if (!f[kind]) continue;
        if (metadata.has(kind)) this.error("P021", `a model has at most one \`@${kind}\` field`, at);
        metadata.set(kind, f);
        if (f.transient) conflict("transient", kind);
        if (f.initial && kind !== "lastSeen") conflict(kind, "initial");
      }
      if (f.id) {
        if (idFieldSeen) this.error("P022", "a type has at most one `@id` field", at);
        idFieldSeen = f;
      }
    }
    if (d.kind === "model" && d.migrations.length > 0 && !versionField) {
      this.error("P020", `\`${d.name}\` has migrations but no \`@version\` field`, d.node.name.span, { help: "add `Version Int = 1 @version`" });
    }
  }

  private resolveCounters(d: ModelDecl | TypeDecl): void {
    for (const f of d.fields) {
      if (!f.counter) continue;
      const attr = f.node.attributes.find((a) => a.name.text === "counter")!;
      const arg = attr.args[0] as { kind: "name"; parts: string[]; span: Span };
      const [listName, fieldName] = arg.parts as [string, string];
      const list = d.fields.find((x) => x.name === listName);
      if (!list || list.type.container !== "list" || list.type.base.kind !== "record") {
        this.error("P023", `\`${listName}\` is not a list of records in \`${d.name}\``, arg.span);
        f.counter = undefined;
        continue;
      }
      const target = list.type.base.decl.fields.find((x) => x.name === fieldName);
      if (!target || !target.id) {
        this.error("P023", `\`${fieldName}\` is not the \`@id\` field of \`${list.type.base.decl.name}\``, arg.span, {
          help: `mark it with \`@id\` in \`type ${list.type.base.decl.name}\``,
        });
        f.counter = undefined;
        continue;
      }
      f.counter = { list, idField: target };
    }
  }

  private checkCycles(): void {
    const state = new Map<string, "visiting" | "done">();
    const visit = (t: TypeDecl): boolean => {
      if (state.get(t.name) === "done") return false;
      if (state.get(t.name) === "visiting") return true;
      state.set(t.name, "visiting");
      for (const f of t.fields) {
        if (f.type.base.kind === "record" && visit(f.type.base.decl)) {
          if (state.get(t.name) !== "done") this.error("P026", `\`${t.name}\` contains itself through \`${f.name}\``, f.node.name.span);
          state.set(t.name, "done");
          return false;
        }
      }
      state.set(t.name, "done");
      return false;
    };
    for (const t of this.types.values()) visit(t);
  }

  private checkModuleNames(): void {
    const owners = new Map<string, string>();
    const claim = (name: string, owner: string, span: Span): void => {
      if (isReserved(name) || isBuiltin(name)) {
        this.error("P028", `${owner} would generate \`${name}\`, a built-in Verse name`, span, { help: "rename it, or set another class name with `@@map`" });
      }
      const prev = owners.get(name);
      if (prev && prev !== owner) this.error("P019", `\`${name}\` would be generated for both ${prev} and ${owner}`, span, { help: "rename one of them, or change its `@@map`" });
      owners.set(name, owner);
    };
    for (const e of this.enums.values()) claim(e.verseName, `enum ${e.name}`, e.node.name.span);
    for (const t of this.types.values()) claim(t.recordClass, `type ${t.name}`, t.node.name.span);
    for (const m of this.models.values()) {
      const span = m.node.name.span;
      claim(m.recordClass, `the record of ${m.name}`, span);
      claim(snake(m.name), `model ${m.name}`, span);
      claim(`${snake(m.name)}_field`, `model ${m.name}`, span);
      claim(`${snake(m.name)}_store`, `model ${m.name}`, span);
      claim(m.storeVar, `the store of ${m.name}`, span);
      claim(`${m.name}Store`, `model ${m.name}`, span);
      claim(`${m.name}Live`, `model ${m.name}`, span);
      this.checkIdentifier(m.storeVar, span);
    }
  }

  private checkMembers(m: ModelDecl, settings: Settings): void {
    const owner = new Map<string, string>();
    for (const fixed of MODEL_MEMBERS) owner.set(fixed, "Prism");
    const claim = (name: string, f: Field): void => {
      const prev = owner.get(name);
      if (prev && prev !== f.name) {
        this.error("P028", `\`${name}\` clashes with ${prev === "Prism" ? "a member generated by Prism" : `a member generated for \`${prev}\``}`, f.node.name.span, {
          help: prev === "Prism" ? "rename the field" : "rename a field, or set `@item` on the list",
        });
      }
      owner.set(name, f.name);
    };
    for (const f of m.fields.filter(inModel)) claim(f.name, f);
    for (const f of m.fields.filter(inModel)) {
      for (const name of memberNames(f, settings.methodPrefix)) claim(name, f);
    }
  }

  // Column names must not clash with other saved names; lists that can't be columns are reported once.
  private checkColumns(): void {
    for (const d of [...this.models.values(), ...this.types.values()]) {
      const names = new Map<string, string>();
      for (const f of persistedFields(d)) {
        const columns = columnType(f);
        const saved = columns ? columns.fields.map((c) => `${f.persisted}_${c.persisted}`) : [f.persisted];
        for (const n of saved) {
          const other = names.get(n);
          if (other) this.error("P019", `\`${f.name}\` saves a column named \`${n}\`, already used by \`${other}\``, f.node.name.span, { help: "rename one of them with `@map`" });
          names.set(n, f.name);
        }
        if (!f.owner || f.type.container !== "list" || f.type.base.kind !== "record" || columns || f.type.base.decl.rows) continue;
        const t = f.type.base.decl;
        const blocker = t.fields.find((x) => x.type.container !== "none" || x.type.base.kind === "record");
        this.reporter.warning("P042", `\`${f.name}\` is saved as objects, about 200 bytes of metadata per item: \`${t.name}.${blocker?.name ?? "?"}\` is a list, an option or a type`, { file: this.file, span: f.node.name.span }, {
          help: `keep the fields of \`${t.name}\` flat to save it in columns, or add \`@@rows\` to \`type ${t.name}\` to keep this format`,
        });
      }
    }
    for (const t of this.types.values()) {
      if (!t.rows || !columnEligible(t)) continue;
      const span = t.node.attributes.find((a) => a.name.text === "rows")!.span;
      this.reporter.warning("P043", `\`@@rows\` saves \`${t.name}\` as objects, several times larger than columns`, { file: this.file, span }, {
        help: "remove `@@rows` unless saves in this format are already published",
      });
    }
  }

  private checkSize(m: ModelDecl): void {
    const unbounded: Field[] = [];
    const bytes = worstCase(m, unbounded);
    for (const f of unbounded.filter((x) => !x.trim)) {
      this.reporter.warning("P041", `list \`${f.name}\` has no \`@maxItems\`: its size is unbounded`, { file: this.file, span: f.node.name.span }, {
        help: "cap it with `@maxItems(n)`, or mark it `@trim(head)` if old items can be dropped",
      });
    }
    if (bytes > PLAYER_MAP_LIMIT) {
      this.reporter.warning("P040", `\`${m.name}\` can reach about ${Math.ceil(bytes / 1024)} KB, above the 256 KB player map limit`, { file: this.file, span: m.node.name.span }, {
        help: "lower the `@maxItems` of the largest lists, or split the data across two models",
      });
    }
  }

  private checkIdentifier(name: string, span: Span): void {
    if (isReserved(name)) this.error("P028", `\`${name}\` is a Verse reserved word`, span);
    else if (isBuiltin(name)) this.error("P028", `\`${name}\` is a built-in Verse name, so it would be ambiguous`, span, { help: "rename it; the saved name can differ with `@map`" });
  }

  private error(code: string, message: string, span: Span, extra: { help?: string | undefined; label?: string } = {}): void {
    const clean: { help?: string; label?: string } = {};
    if (extra.help !== undefined) clean.help = extra.help;
    if (extra.label !== undefined) clean.label = extra.label;
    this.reporter.error(code, message, { file: this.file, span }, clean);
  }
}

export const MODEL_MEMBERS = [
  "Changed", "FieldChanged", "SaveBlocked", "Dirty", "ReadOnly", "OfflineSeconds", "HasRecord", "NextWriteAt", "NextCheckAt",
  "Notify", "Commit", "Touched", "ChangedFields", "CommitPending", "Touch", "TakeCommit", "LoadRecord", "ToRecord", "MarkSaved",
  "Clear",
];

export function memberNames(f: Field, prefix: string): string[] {
  if (isMetadata(f)) return [];
  const n = f.name;
  const names = [`${prefix}Set${n}`];
  if (isNumeric(f.type) && !f.counter) names.push(`${prefix}Add${n}`);
  if (f.type.container === "none" && f.type.base.kind === "scalar" && f.type.base.name === "Bool") names.push(`${prefix}Toggle${n}`);
  if (f.type.container === "list") {
    if (isIdList(f)) names.push(`${prefix}Find${f.item}`, `${prefix}Upsert${f.item}`, `${prefix}Delete${f.item}`);
    else names.push(`${prefix}Push${f.item}`, `${prefix}Set${f.item}At`, `${prefix}Delete${f.item}At`);
  }
  if (f.counter) names.push(`${prefix}Take${n}`);
  return names;
}

export function typeName(t: FieldType): string {
  const base = t.base.kind === "scalar" ? t.base.name : t.base.decl.name;
  return t.container === "list" ? `${base}[]` : t.container === "option" ? `${base}?` : base;
}

function literalProblem(t: FieldType, lit: Literal): string | undefined {
  if (lit.kind === "name") return undefined;
  if (t.container === "list") {
    if (lit.kind !== "list") return "expected a list such as `[]` or `[1, 2]`";
    for (const item of lit.items) {
      const p = literalProblem({ base: t.base, container: "none" }, item);
      if (p) return p;
    }
    return undefined;
  }
  if (t.container === "option") {
    if (lit.kind === "none") return undefined;
    return literalProblem({ base: t.base, container: "none" }, lit);
  }
  const b = t.base;
  if (b.kind === "record") return "a record field takes no default";
  if (b.kind === "enum") return "expected an enum value such as `" + `${b.decl.name}.${b.decl.values[0] ?? "Value"}` + "`";
  switch (b.name) {
    case "Int":
      return lit.kind === "int" ? undefined : "expected an integer";
    case "Float":
      return lit.kind === "float" || lit.kind === "int" ? undefined : "expected a number";
    case "Bool":
      return lit.kind === "bool" ? undefined : "expected `true` or `false`";
    case "String":
      return lit.kind === "string" ? undefined : 'expected a string such as `"text"`';
  }
}

// Verse reserves module (folder) names in the whole package: a field, enum value or store named like one is ambiguous.
export function checkReservedNames(schema: Schema, modules: ReadonlySet<string>, reporter: Reporter): void {
  const clash = (name: string, span: Span, what: string): void => {
    if (!modules.has(name)) return;
    reporter.error("P033", `${what} \`${name}\` has the name of a Verse module of this project`, { file: schema.file, span }, {
      help: "Verse reserves module names in the whole package: rename it (a folder name also counts as a module)",
    });
  };
  for (const d of [...schema.models, ...schema.types]) {
    for (const f of d.fields) {
      clash(f.name, f.node.name.span, "field");
      if (f.persisted !== f.name) clash(f.persisted, f.node.name.span, "saved field");
    }
  }
  for (const e of schema.enums) for (const v of e.node.values) clash(v.text, v.span, "enum value");
  for (const m of schema.models) {
    for (const name of [m.storeVar, `${m.name}Store`, `${m.name}Live`]) clash(name, m.node.name.span, "generated name");
  }
}
