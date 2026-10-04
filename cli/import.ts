import type { Reporter } from "./diagnostics.ts";
import { pascal, snake } from "./names.ts";
import type { Scan, ScannedClass, ScannedField } from "./verse_scan.ts";

const SCALAR: Record<string, string> = { int: "Int", float: "Float", logic: "Bool", string: "String" };
const IMPLICIT: Record<string, string> = { int: "0", float: "0.0", logic: "false", string: '""' };

// Writes a schema that reproduces existing persistable classes, to adopt Prism in a published game.
export function importSchema(scan: Scan, sources: string[], reporter: Reporter): string {
  const enumNames = new Map(scan.enums.map((e) => [e.name, pascal(e.name)]));
  const roots = new Map<string, string>();
  let kind = "player";
  for (const s of scan.stores) {
    const memory = s.key === "session" && s.value.startsWith("[player]");
    const value = memory ? s.value.slice("[player]".length) : s.value;
    if (s.key === "player" || memory) {
      roots.set(value, s.name);
      if (memory) kind = "memory";
    }
  }
  const typeName = (cls: string): string => (roots.has(cls) ? modelName(cls) : pascal(cls));
  const classNames = new Set(scan.classes.map((c) => c.name));
  const schemaType = (verse: string): string | undefined => {
    if (verse.startsWith("[]")) {
      const inner = schemaType(verse.slice(2));
      return inner && !inner.endsWith("[]") && !inner.endsWith("?") ? `${inner}[]` : undefined;
    }
    if (verse.startsWith("?")) {
      const inner = schemaType(verse.slice(1));
      return inner && !inner.endsWith("[]") && !inner.endsWith("?") ? `${inner}?` : undefined;
    }
    if (SCALAR[verse]) return SCALAR[verse];
    if (enumNames.has(verse)) return enumNames.get(verse);
    if (classNames.has(verse)) return typeName(verse);
    return undefined;
  };
  const out: string[] = [`// Imported by prism-verse from ${sources.join(", ")}. Review it, then run \`lock\` and \`check --against\`.`, ""];
  out.push("datasource {", `  kind = "${kind}"`, "}", "");
  const ordered = [...scan.classes].sort((a, b) => Number(roots.has(b.name)) - Number(roots.has(a.name)));
  for (const cls of ordered) {
    const isModel = roots.has(cls.name);
    const name = typeName(cls.name);
    out.push(`${isModel ? "model" : "type"} ${name} {`);
    const rows: string[][] = [];
    const notes: string[] = [];
    for (const f of cls.fields) {
      const t = schemaType(f.type);
      if (!t) {
        reporter.warning("P302", `\`${cls.name}.${f.name}\` has type \`${f.type}\`, which has no schema equivalent`, { file: cls.file, span: f.span }, {
          help: "it is kept as a comment; such a class can't be managed by Prism yet",
        });
        notes.push(`  // ${f.name}: ${f.type} (unsupported)`);
        continue;
      }
      const def = schemaDefault(f, enumNames);
      rows.push([f.name, t, def === undefined ? "" : `= ${def}`]);
    }
    out.push(...align(rows), ...notes);
    const mapped = isModel ? `${snake(name)}_record` : snake(name);
    const block: string[] = [];
    if (mapped !== cls.name) block.push(`  @@map("${cls.name}")`);
    if (!isModel) block.push("  @@rows");
    if (isModel) {
      const store = roots.get(cls.name)!;
      if (store !== `${name}Saves`) block.push(`  @@store("${store}")`);
    }
    if (block.length > 0) out.push("", ...block);
    out.push("}", "");
  }
  for (const e of scan.enums) out.push(`enum ${pascal(e.name)} { ${e.values.join(" ")} }`, "");
  if (scan.classes.length === 0) reporter.error("P301", "no persistable class found in the given files");
  while (out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}

// The model name is only API: when it would produce the record's own class name, suffix it.
function modelName(cls: string): string {
  if (cls.endsWith("_record")) return pascal(cls.slice(0, -"_record".length));
  return snake(pascal(cls)) === cls ? `${pascal(cls)}Model` : pascal(cls);
}

function align(rows: string[][]): string[] {
  const widths = [0, 0];
  for (const r of rows) {
    widths[0] = Math.max(widths[0]!, r[0]!.length);
    widths[1] = Math.max(widths[1]!, r[1]!.length);
  }
  return rows.map((r) => `  ${r[0]!.padEnd(widths[0]!)} ${r[2] ? r[1]!.padEnd(widths[1]!) + " " + r[2] : r[1]}`.trimEnd());
}

function schemaDefault(f: ScannedField, enums: Map<string, string>): string | undefined {
  const v = f.default;
  if (v === undefined) return undefined;
  if (f.type.startsWith("[]")) {
    if (v === "array{}") return undefined;
    const m = /^array\{(.*)\}$/.exec(v);
    return m ? `[${m[1]}]` : v;
  }
  if (f.type.startsWith("?")) return v === "false" ? undefined : v;
  if (IMPLICIT[f.type] === v) return undefined;
  if (/^[a-z_]\w*\{\}$/.test(v)) return undefined;
  const qualified = /^([a-z_]\w*)\.(\w+)$/.exec(v);
  if (qualified && enums.has(qualified[1]!)) return `${enums.get(qualified[1]!)}.${qualified[2]}`;
  return v;
}

export type { ScannedClass };
