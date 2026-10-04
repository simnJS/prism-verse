import type { Span } from "./source.ts";

export interface Name {
  text: string;
  span: Span;
}

export type Literal =
  | { kind: "int"; text: string; span: Span }
  | { kind: "float"; text: string; span: Span }
  | { kind: "bool"; value: boolean; span: Span }
  | { kind: "string"; value: string; span: Span }
  | { kind: "list"; items: Literal[]; span: Span }
  | { kind: "none"; span: Span }
  | { kind: "name"; parts: string[]; span: Span };

export interface AttributeNode {
  name: Name;
  args: Literal[];
  span: Span;
}

export type Container = "none" | "list" | "option";

export interface TypeNode {
  name: Name;
  container: Container;
  nested: boolean;
  span: Span;
}

export interface FieldNode {
  name: Name;
  type: TypeNode;
  default: Literal | undefined;
  attributes: AttributeNode[];
  span: Span;
}

export interface BlockNode {
  keyword: "model" | "type";
  name: Name;
  fields: FieldNode[];
  attributes: AttributeNode[];
  span: Span;
}

export interface EnumNode {
  name: Name;
  values: Name[];
  span: Span;
}

export interface SettingNode {
  key: Name;
  value: Literal;
}

export interface SettingsNode {
  keyword: "datasource" | "generator";
  entries: SettingNode[];
  span: Span;
}

export interface SchemaNode {
  settings: SettingsNode[];
  blocks: BlockNode[];
  enums: EnumNode[];
}
