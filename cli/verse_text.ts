import type { Literal } from "./ast.ts";
import type { Field, FieldType, Schema } from "./schema.ts";

export function verseType(t: FieldType): string {
  const b = t.base;
  const base = b.kind === "scalar" ? { Int: "int", Float: "float", Bool: "logic", String: "string" }[b.name] : b.kind === "enum" ? b.decl.verseName : b.decl.recordClass;
  return t.container === "list" ? `[]${base}` : t.container === "option" ? `?${base}` : base;
}

export function implicitDefault(t: FieldType): string {
  if (t.container === "list") return "array{}";
  if (t.container === "option") return "false";
  const b = t.base;
  if (b.kind === "record") return `${b.decl.recordClass}{}`;
  if (b.kind === "enum") return `${b.decl.verseName}.${b.decl.values[0]}`;
  return { Int: "0", Float: "0.0", Bool: "false", String: '""' }[b.name];
}

export function persistedDefault(schema: Schema, f: Field): string {
  return f.def ? value(schema, f.def, f.type) : implicitDefault(f.type);
}

export function initialValue(schema: Schema, f: Field): string {
  return f.initial ? value(schema, f.initial, f.type) : persistedDefault(schema, f);
}

export function value(schema: Schema, lit: Literal, t: FieldType): string {
  if (t.container === "option" && lit.kind !== "none" && lit.kind !== "name") return `option{${value(schema, lit, { base: t.base, container: "none" })}}`;
  switch (lit.kind) {
    case "name": {
      const e = schema.enums.find((x) => x.name === lit.parts[0]);
      if (e && lit.parts.length === 2) return `${e.verseName}.${lit.parts[1]}`;
      if (t.base.kind === "enum" && lit.parts.length === 1 && t.base.decl.values.includes(lit.parts[0]!)) return `${t.base.decl.verseName}.${lit.parts[0]}`;
      return lit.parts.join(".");
    }
    case "none":
      return "false";
    case "list": {
      const item: FieldType = { base: t.base, container: "none" };
      return `array{${lit.items.map((i) => value(schema, i, item)).join(", ")}}`;
    }
    case "bool":
      return lit.value ? "true" : "false";
    case "string":
      return `"${lit.value.replace(/[\\"{}]/g, (c) => `\\${c}`).replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
    case "int":
    case "float": {
      const isFloat = t.base.kind === "scalar" && t.base.name === "Float";
      let text = lit.text;
      if (isFloat && !/[.eE]/.test(text)) text += ".0";
      else if (isFloat && /[eE]/.test(text) && !text.includes(".")) text = text.replace(/[eE]/, ".0e");
      return text;
    }
  }
}
