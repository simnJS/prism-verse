import type { AttributeNode, BlockNode, Container, EnumNode, FieldNode, Literal, Name, SchemaNode, SettingsNode, TypeNode } from "./ast.ts";
import type { Reporter } from "./diagnostics.ts";
import { lex, type Token } from "./lexer.ts";
import type { SourceFile, Span } from "./source.ts";

const BLOCKS = ["datasource", "generator", "model", "type", "enum"];

class ParseError extends Error {}

export function parse(file: SourceFile, reporter: Reporter): SchemaNode {
  return new Parser(file, reporter).schema();
}

class Parser {
  private readonly tokens: Token[];
  private pos = 0;
  private readonly file: SourceFile;
  private readonly reporter: Reporter;

  constructor(file: SourceFile, reporter: Reporter) {
    this.file = file;
    this.reporter = reporter;
    this.tokens = lex(file, reporter);
  }

  schema(): SchemaNode {
    const schema: SchemaNode = { settings: [], blocks: [], enums: [] };
    for (;;) {
      this.skipNewlines();
      const t = this.peek();
      if (t.kind === "eof") return schema;
      try {
        if (t.kind === "ident" && (t.text === "datasource" || t.text === "generator")) schema.settings.push(this.settings());
        else if (t.kind === "ident" && (t.text === "model" || t.text === "type")) schema.blocks.push(this.block());
        else if (t.kind === "ident" && t.text === "enum") schema.enums.push(this.enumBlock());
        else {
          this.reporter.error("P004", `unknown block \`${t.text}\``, this.at(t.span), {
            help: "a schema holds `datasource`, `generator`, `model`, `type` and `enum` blocks",
          });
          throw new ParseError();
        }
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        this.recoverToBlock();
      }
    }
  }

  private settings(): SettingsNode {
    const keyword = this.next().text as "datasource" | "generator";
    const start = this.prev().span.start;
    this.expect("{");
    const node: SettingsNode = { keyword, entries: [], span: { start, end: start } };
    for (;;) {
      this.skipNewlines();
      if (this.accept("}")) break;
      try {
        const key = this.ident("a setting name");
        this.expect("=");
        node.entries.push({ key, value: this.literal() });
        this.endOfLine();
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        if (this.recoverToLine()) break;
      }
    }
    node.span.end = this.prev().span.end;
    return node;
  }

  private block(): BlockNode {
    const keyword = this.next().text as "model" | "type";
    const start = this.prev().span.start;
    const name = this.ident(`a ${keyword} name`);
    this.expect("{");
    const node: BlockNode = { keyword, name, fields: [], attributes: [], span: { start, end: start } };
    for (;;) {
      this.skipNewlines();
      if (this.accept("}")) break;
      try {
        if (this.peek().text === "@@") node.attributes.push(this.attribute("@@"));
        else node.fields.push(this.field());
        this.endOfLine();
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        if (this.recoverToLine()) break;
      }
    }
    node.span.end = this.prev().span.end;
    return node;
  }

  private enumBlock(): EnumNode {
    const start = this.next().span.start;
    const name = this.ident("an enum name");
    this.expect("{");
    const values: Name[] = [];
    for (;;) {
      this.skipNewlines();
      if (this.accept("}")) break;
      if (this.accept(",")) continue;
      values.push(this.ident("an enum value"));
    }
    return { name, values, span: { start, end: this.prev().span.end } };
  }

  private field(): FieldNode {
    const name = this.ident("a field name");
    const type = this.typeNode();
    let def: Literal | undefined;
    if (this.accept("=")) def = this.literal();
    const attributes: AttributeNode[] = [];
    while (this.peek().text === "@") attributes.push(this.attribute("@"));
    if (this.peek().text === "@@") {
      this.reporter.error("P002", "block attributes go on their own line", this.at(this.peek().span), {
        help: "move this `@@` attribute to a separate line at the end of the block",
      });
      throw new ParseError();
    }
    return { name, type, default: def, attributes, span: { start: name.span.start, end: this.prev().span.end } };
  }

  private typeNode(): TypeNode {
    const name = this.ident("a type");
    let container: Container = "none";
    let nested = false;
    for (;;) {
      if (this.peek().text === "[" && this.peekAt(1).text === "]") {
        this.pos += 2;
        if (container !== "none") nested = true;
        container = "list";
      } else if (this.accept("?")) {
        if (container !== "none") nested = true;
        container = "option";
      } else break;
    }
    return { name, container, nested, span: { start: name.span.start, end: this.prev().span.end } };
  }

  private attribute(sigil: "@" | "@@"): AttributeNode {
    const start = this.next().span.start;
    const nameToken = this.peek();
    if (nameToken.kind !== "ident" || nameToken.span.start !== this.prev().span.end) {
      this.reporter.error("P002", `expected an attribute name right after \`${sigil}\``, this.at(nameToken.span));
      throw new ParseError();
    }
    this.pos++;
    const name: Name = { text: nameToken.text, span: { start, end: nameToken.span.end } };
    const args: Literal[] = [];
    if (this.peek().text === "(" && this.peek().span.start === nameToken.span.end) {
      this.pos++;
      if (!this.accept(")")) {
        do args.push(this.literal());
        while (this.accept(","));
        this.expect(")");
      }
    }
    return { name, args, span: { start, end: this.prev().span.end } };
  }

  private literal(): Literal {
    const t = this.peek();
    if (t.kind === "int") return this.next(), { kind: "int", text: t.text, span: t.span };
    if (t.kind === "float") return this.next(), { kind: "float", text: t.text, span: t.span };
    if (t.kind === "string") return this.next(), { kind: "string", value: t.value, span: t.span };
    if (t.text === "[") {
      this.next();
      const items: Literal[] = [];
      if (!this.accept("]")) {
        do items.push(this.literal());
        while (this.accept(","));
        this.expect("]");
      }
      return { kind: "list", items, span: { start: t.span.start, end: this.prev().span.end } };
    }
    if (t.kind === "ident") {
      this.next();
      if (t.text === "true" || t.text === "false") return { kind: "bool", value: t.text === "true", span: t.span };
      if (t.text === "none") return { kind: "none", span: t.span };
      const parts = [t.text];
      while (this.peek().text === "." && this.peekAt(1).kind === "ident") {
        this.pos++;
        parts.push(this.next().text);
      }
      return { kind: "name", parts, span: { start: t.span.start, end: this.prev().span.end } };
    }
    this.reporter.error("P002", `expected a value, found ${describe(t)}`, this.at(t.span), {
      help: "values are numbers, `true`/`false`, \"strings\", `[lists]`, `none` or names",
    });
    throw new ParseError();
  }

  private ident(what: string): Name {
    const t = this.peek();
    if (t.kind !== "ident") {
      this.reporter.error("P002", `expected ${what}, found ${describe(t)}`, this.at(t.span));
      throw new ParseError();
    }
    this.pos++;
    return { text: t.text, span: t.span };
  }

  private expect(text: string): void {
    const t = this.peek();
    if (t.text !== text || t.kind === "string") {
      this.reporter.error("P002", `expected \`${text}\`, found ${describe(t)}`, this.at(t.span));
      throw new ParseError();
    }
    this.pos++;
  }

  private endOfLine(): void {
    const t = this.peek();
    if (t.kind === "newline" || t.kind === "eof" || t.text === "}") return;
    this.reporter.error("P002", `expected the end of the line, found ${describe(t)}`, this.at(t.span), {
      help: "one field or setting per line; attributes start with `@`",
    });
    throw new ParseError();
  }

  private accept(text: string): boolean {
    const t = this.peek();
    if (t.text === text && t.kind !== "string") {
      this.pos++;
      return true;
    }
    return false;
  }

  private skipNewlines(): void {
    while (this.peek().kind === "newline") this.pos++;
  }

  // Returns true when the recovery consumed the block's closing brace.
  private recoverToLine(): boolean {
    for (;;) {
      const t = this.peek();
      if (t.kind === "eof") return true;
      if (t.kind === "newline") return false;
      this.pos++;
      if (t.text === "}") return true;
    }
  }

  private recoverToBlock(): void {
    for (;;) {
      const t = this.peek();
      if (t.kind === "eof") return;
      const atLineStart = this.prevKind() === "newline";
      if (t.kind === "ident" && atLineStart && BLOCKS.includes(t.text)) return;
      this.pos++;
    }
  }

  private prevKind(): string {
    return this.pos === 0 ? "newline" : (this.tokens[this.pos - 1]?.kind ?? "newline");
  }

  private peek(): Token {
    return this.peekAt(0);
  }

  private peekAt(offset: number): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)] as Token;
  }

  private next(): Token {
    const t = this.peek();
    if (t.kind !== "eof") this.pos++;
    return t;
  }

  private prev(): Token {
    return this.tokens[Math.max(0, this.pos - 1)] as Token;
  }

  private at(span: Span): { file: SourceFile; span: Span } {
    return { file: this.file, span };
  }
}

function describe(t: Token): string {
  if (t.kind === "eof") return "the end of the file";
  if (t.kind === "newline") return "the end of the line";
  return `\`${t.text}\``;
}
