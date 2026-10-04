import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, Reporter } from "../cli/diagnostics.ts";
import { checkReservedNames, loadSchema, type Schema } from "../cli/schema.ts";
import { SourceFile } from "../cli/source.ts";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const UPDATE = process.env["UPDATE_SNAPSHOTS"] === "1";

export interface Analyzed {
  schema: Schema;
  reporter: Reporter;
  codes: string[];
  all: string[];
  rendered: string;
}

export function analyze(text: string, name = "save.prism", modules: string[] = []): Analyzed {
  const reporter = new Reporter();
  const schema = loadSchema(new SourceFile(name, text), reporter, "save");
  if (modules.length > 0) checkReservedNames(schema, new Set(modules), reporter);
  const errors = reporter.diagnostics.filter((d) => d.severity === "error");
  return { schema, reporter, codes: errors.map((d) => d.code), all: reporter.diagnostics.map((d) => d.code), rendered: reporter.diagnostics.map(render).join("\n\n") };
}
