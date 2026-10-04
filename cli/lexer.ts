import type { Reporter } from "./diagnostics.ts";
import type { SourceFile, Span } from "./source.ts";

export type TokenKind = "ident" | "int" | "float" | "string" | "punct" | "newline" | "eof";

export interface Token {
  kind: TokenKind;
  text: string;
  value: string;
  span: Span;
}

const PUNCT = new Set(["{", "}", "(", ")", "[", "]", "=", ",", ".", "?"]);

export function lex(file: SourceFile, reporter: Reporter): Token[] {
  const text = file.text;
  const tokens: Token[] = [];
  let i = 0;
  const push = (kind: TokenKind, start: number, end: number, value?: string): void => {
    const raw = text.slice(start, end);
    tokens.push({ kind, text: raw, value: value ?? raw, span: { start, end } });
  };
  while (i < text.length) {
    const c = text[i] ?? "";
    if (c === "\n") {
      push("newline", i, i + 1);
      i++;
    } else if (c === " " || c === "\t" || c === "\r") {
      i++;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < text.length && /[A-Za-z0-9_]/.test(text[i] ?? "")) i++;
      push("ident", start, i);
    } else if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(text[i + 1] ?? ""))) {
      const start = i;
      i++;
      while (/[0-9]/.test(text[i] ?? "")) i++;
      let kind: TokenKind = "int";
      if (text[i] === "." && /[0-9]/.test(text[i + 1] ?? "")) {
        kind = "float";
        i++;
        while (/[0-9]/.test(text[i] ?? "")) i++;
      }
      if ((text[i] === "e" || text[i] === "E") && /[-+0-9]/.test(text[i + 1] ?? "")) {
        kind = "float";
        i += 2;
        while (/[0-9]/.test(text[i] ?? "")) i++;
      }
      push(kind, start, i);
    } else if (c === '"') {
      const start = i;
      i++;
      let value = "";
      let closed = false;
      while (i < text.length && text[i] !== "\n") {
        const ch = text[i] ?? "";
        if (ch === "\\") {
          const next = text[i + 1] ?? "";
          value += next === "n" ? "\n" : next === "t" ? "\t" : next;
          i += 2;
        } else if (ch === '"') {
          i++;
          closed = true;
          break;
        } else {
          value += ch;
          i++;
        }
      }
      if (!closed) {
        reporter.error("P003", "unterminated string", { file, span: { start, end: i } }, { help: 'close it with `"` on the same line' });
      }
      push("string", start, i, value);
    } else if (c === "@") {
      const start = i;
      i += text[i + 1] === "@" ? 2 : 1;
      push("punct", start, i);
    } else if (PUNCT.has(c)) {
      push("punct", i, i + 1);
      i++;
    } else {
      reporter.error("P001", `unexpected character \`${c}\``, { file, span: { start: i, end: i + 1 } });
      i++;
    }
  }
  push("eof", text.length, text.length);
  return tokens;
}
