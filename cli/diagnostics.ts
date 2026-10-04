import type { SourceFile, Span } from "./source.ts";

export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  file?: SourceFile;
  span?: Span;
  label?: string;
  help?: string;
}

export class Reporter {
  readonly diagnostics: Diagnostic[] = [];

  error(code: string, message: string, at?: Location, extra: Extra = {}): void {
    this.diagnostics.push(make("error", code, message, at, extra));
  }

  warning(code: string, message: string, at?: Location, extra: Extra = {}): void {
    this.diagnostics.push(make("warning", code, message, at, extra));
  }

  get hasErrors(): boolean {
    return this.diagnostics.some((d) => d.severity === "error");
  }
}

export interface Location {
  file: SourceFile;
  span: Span;
}

export interface Extra {
  label?: string;
  help?: string;
}

function make(severity: Severity, code: string, message: string, at: Location | undefined, extra: Extra): Diagnostic {
  const d: Diagnostic = { code, severity, message };
  if (at) {
    d.file = at.file;
    d.span = at.span;
  }
  if (extra.label !== undefined) d.label = extra.label;
  if (extra.help !== undefined) d.help = extra.help;
  return d;
}

export function render(d: Diagnostic): string {
  const head = `${d.severity}[${d.code}]: ${d.message}`;
  if (!d.file || !d.span) {
    return d.help ? `${head}\n  = help: ${d.help}` : head;
  }
  const { line, column } = d.file.position(d.span.start);
  const text = d.file.lineText(line);
  const gutter = String(line).length;
  const pad = " ".repeat(gutter);
  const width = Math.max(1, Math.min(d.span.end - d.span.start, text.length - column + 1));
  const marker = " ".repeat(column - 1) + "^".repeat(width) + (d.label ? ` ${d.label}` : "");
  const lines = [
    `${d.file.name}:${line}:${column} ${head}`,
    `${pad} |`,
    `${line} | ${text}`,
    `${pad} | ${marker}`,
  ];
  if (d.help) lines.push(`${pad} = help: ${d.help}`);
  return lines.join("\n");
}

export type Format = "text" | "json" | "github";

export function renderAll(diagnostics: Diagnostic[], format: Format): string {
  if (format === "json") {
    return JSON.stringify(
      diagnostics.map((d) => {
        const pos = d.file && d.span ? d.file.position(d.span.start) : undefined;
        return { code: d.code, severity: d.severity, message: d.message, file: d.file?.name ?? null, line: pos?.line ?? null, column: pos?.column ?? null, label: d.label ?? null, help: d.help ?? null };
      }),
      null,
      2,
    );
  }
  if (format === "github") {
    return diagnostics
      .map((d) => {
        const pos = d.file && d.span ? d.file.position(d.span.start) : undefined;
        const where = d.file ? `file=${d.file.name},line=${pos?.line ?? 1},col=${pos?.column ?? 1},` : "";
        const body = (d.help ? `${d.message}\nhelp: ${d.help}` : d.message).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
        return `::${d.severity} ${where}title=prism-verse ${d.code}::${body}`;
      })
      .join("\n");
  }
  return diagnostics.map(render).join("\n\n");
}
