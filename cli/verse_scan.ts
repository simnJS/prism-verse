import type { SourceFile, Span } from "./source.ts";

export interface ScannedField {
  name: string;
  type: string;
  default: string | undefined;
  span: Span;
}

export interface ScannedClass {
  name: string;
  fields: ScannedField[];
  file: SourceFile;
  span: Span;
}

export interface ScannedEnum {
  name: string;
  values: string[];
  file: SourceFile;
  span: Span;
}

export interface ScannedStore {
  name: string;
  key: "player" | "session";
  value: string;
  file: SourceFile;
  span: Span;
}

export interface Scan {
  classes: ScannedClass[];
  enums: ScannedEnum[];
  stores: ScannedStore[];
}

const SPECS = String.raw`(?:<[^>]*>)*`;
const CLASS = new RegExp(String.raw`^([A-Za-z_]\w*)${SPECS}\s*:=\s*class(${SPECS})\s*:\s*$`);
const ENUM_INLINE = new RegExp(String.raw`^([A-Za-z_]\w*)${SPECS}\s*:=\s*enum(${SPECS})\s*\{([^}]*)\}\s*$`);
const ENUM_BLOCK = new RegExp(String.raw`^([A-Za-z_]\w*)${SPECS}\s*:=\s*enum(${SPECS})\s*:\s*$`);
const FIELD = new RegExp(String.raw`^([A-Za-z_]\w*)${SPECS}\s*:\s*(.+?)\s*(?:=\s*(.+?))?\s*$`);
const STORE = new RegExp(String.raw`^var\s+([A-Za-z_]\w*)${SPECS}\s*:\s*weak_map\(\s*(player|session)\s*,\s*(.+)\)\s*=`);

export function scanVerse(files: SourceFile[]): Scan {
  const scan: Scan = { classes: [], enums: [], stores: [] };
  for (const file of files) scanFile(file, scan);
  return scan;
}

function scanFile(file: SourceFile, scan: Scan): void {
  const lines = file.text.split("\n").map((l) => l.replace(/\r$/, ""));
  const offset = (line: number): number => file.lineStarts[line] ?? 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = stripComment(lines[i]!);
    if (raw.trim() === "" || /^\s/.test(raw)) continue;
    const span = { start: offset(i), end: offset(i) + raw.length };
    const store = STORE.exec(raw);
    if (store) {
      scan.stores.push({ name: store[1]!, key: store[2] as "player" | "session", value: compact(store[3]!), file, span });
      continue;
    }
    const inline = ENUM_INLINE.exec(raw);
    if (inline) {
      if (inline[2]!.includes("persistable")) {
        scan.enums.push({ name: inline[1]!, values: inline[3]!.split(/[,\s]+/).filter((v) => v.length > 0), file, span });
      }
      continue;
    }
    const block = ENUM_BLOCK.exec(raw);
    if (block) {
      const values: string[] = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]!) || lines[i + 1]!.trim() === "")) {
        i++;
        const v = stripComment(lines[i]!).trim();
        if (v) values.push(...v.split(/[,\s]+/).filter((x) => x.length > 0));
      }
      if (block[2]!.includes("persistable")) scan.enums.push({ name: block[1]!, values, file, span });
      continue;
    }
    const cls = CLASS.exec(raw);
    if (!cls) continue;
    const persistable = cls[2]!.includes("persistable");
    const fields: ScannedField[] = [];
    while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]!) || lines[i + 1]!.trim() === "")) {
      i++;
      const body = stripComment(lines[i]!).trim();
      if (!body || body.includes("(")) continue;
      const m = FIELD.exec(body);
      if (!m || body.startsWith("var ")) continue;
      const start = offset(i) + lines[i]!.indexOf(m[1]!);
      fields.push({ name: m[1]!, type: compact(m[2]!), default: m[3] === undefined ? undefined : normalizeValue(m[3]), span: { start, end: start + body.length } });
    }
    if (persistable) scan.classes.push({ name: cls[1]!, fields, file, span });
  }
}

function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") i++;
    else if (c === '"') inString = !inString;
    else if (c === "#" && !inString) return line.slice(0, i).replace(/\s+$/, "");
  }
  return line;
}

function compact(type: string): string {
  return type.replace(/\s+/g, "");
}

// Spacing differences don't count: `array{ -1 }` equals `array{-1}`.
export function normalizeValue(value: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === "\\" && inString) {
      out += c + (value[i + 1] ?? "");
      i++;
    } else if (c === '"') {
      inString = !inString;
      out += c;
    } else if (/\s/.test(c) && !inString) {
      const prev = out[out.length - 1] ?? "";
      const next = value.slice(i).trimStart()[0] ?? "";
      if (/\w/.test(prev) && /\w/.test(next)) out += " ";
    } else out += c;
  }
  return out.replace(/,(?=\S)/g, ", ");
}
