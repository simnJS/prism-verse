import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { checkAgainst } from "./check.ts";
import { CODES } from "./codes.ts";
import { renderAll, Reporter, type Format } from "./diagnostics.ts";
import { generate } from "./generate.ts";
import { schemaHash } from "./hash.ts";
import { importSchema } from "./import.ts";
import { detectLib, init } from "./init.ts";
import { buildSnapshot, compareHistory, parseSnapshot, serializeSnapshot, type Snapshot } from "./lock.ts";
import { snake } from "./names.ts";
import { checkReservedNames, loadSchema, type Schema, type StoreKind } from "./schema.ts";
import { SourceFile } from "./source.ts";
import { VERSION } from "./version.ts";
import { scanVerse } from "./verse_scan.ts";

const USAGE = `prism-verse ${VERSION}: typed player data for UEFN Verse

Usage:
  prism-verse init <dir> [--demo] [--sync]       copy the Verse runtime into your project
  prism-verse generate <schema> [--check]        write the Verse files next to the schema
  prism-verse lock <schema>                      record the published shape (run it when you publish)
  prism-verse check <schema> [--against <file.verse>...]
  prism-verse import <file.verse>... [--out <schema>]
  prism-verse explain <code>                     what an error code means and how to fix it

Options:
  --check                fail instead of writing when generated files are out of date (generate)
  --format text|json|github
  --lib <path>           module path of the runtime in \`using\` (default: found near the schema)
  --kind memory|player   override datasource.kind
  -v, --version          print the version`;

export interface Io {
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
}

export function run(argv: string[], io: Io): number {
  const args = parseArgs(argv);
  if (args.flags.has("version") || args.flags.has("v")) {
    io.out(VERSION);
    return 0;
  }
  const command = args.positional[0];
  if (!command || command === "help" || args.flags.has("help") || args.flags.has("h")) {
    io.out(USAGE);
    return command ? 0 : 2;
  }
  const format = (args.values.get("format")?.[0] ?? "text") as Format;
  if (!["text", "json", "github"].includes(format)) {
    io.err("error: --format is text, json or github");
    return 2;
  }
  const rest = args.positional.slice(1);
  switch (command) {
    case "init":
      return runInit(rest, args, io);
    case "generate":
    case "lock":
    case "check":
      return runSchemaCommand(command, rest, args, io, format);
    case "import":
      return runImport(rest, args, io, format);
    case "explain":
      return runExplain(rest, io);
    default:
      io.err(`error: unknown command \`${command}\`\n\n${USAGE}`);
      return 2;
  }
}

interface Args {
  positional: string[];
  flags: Set<string>;
  values: Map<string, string[]>;
}

const VALUED = new Set(["lib", "kind", "out", "against", "format"]);

function parseArgs(argv: string[]): Args {
  const args: Args = { positional: [], flags: new Set(), values: new Map() };
  let current: string | undefined;
  for (const a of argv) {
    if (a.startsWith("-")) {
      const [name, inline] = a.replace(/^-+/, "").split("=", 2) as [string, string | undefined];
      current = undefined;
      if (VALUED.has(name)) {
        if (!args.values.has(name)) args.values.set(name, []);
        if (inline !== undefined) args.values.get(name)!.push(inline);
        else current = name;
      } else args.flags.add(name);
    } else if (current) {
      args.values.get(current)!.push(a);
      if (current !== "against") current = undefined;
    } else args.positional.push(a);
  }
  return args;
}

function display(io: Io, path: string): string {
  return relative(io.cwd, path).split("\\").join("/") || basename(path);
}

function report(reporter: Reporter, io: Io, format: Format): void {
  if (reporter.diagnostics.length === 0) return;
  if (format !== "text") {
    io.err(renderAll(reporter.diagnostics, format));
    return;
  }
  io.err(renderAll(reporter.diagnostics, "text") + "\n");
  const errors = reporter.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = reporter.diagnostics.length - errors;
  const parts = [errors ? `${errors} error${errors === 1 ? "" : "s"}` : "", warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : ""].filter((p) => p);
  io.err(parts.join(", "));
}

function readSource(io: Io, path: string, reporter: Reporter): SourceFile | undefined {
  const full = resolve(io.cwd, path);
  if (!existsSync(full)) {
    reporter.error("P901", `file not found: ${display(io, full)}`);
    return undefined;
  }
  return new SourceFile(display(io, full), readFileSync(full, "utf8"));
}

// Published shapes live in prism/<schema name>/0001.json, 0002.json… next to the schema.
export function historyDir(schemaPath: string): string {
  return join(dirname(schemaPath), "prism", basename(schemaPath).replace(/\.prism$/, ""));
}

function readHistory(io: Io, schemaPath: string, reporter: Reporter): { snapshots: Snapshot[]; next: string; latest: string | undefined } {
  const dir = historyDir(schemaPath);
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => /^\d{4}\.json$/.test(n)).sort() : [];
  const snapshots: Snapshot[] = [];
  let latest: string | undefined;
  for (const n of names) {
    const file = readSource(io, join(dir, n), reporter);
    const snap = file && parseSnapshot(file, reporter);
    if (snap) snapshots.push(snap);
    if (file) latest = file.text;
  }
  const number = names.length > 0 ? Number(names[names.length - 1]!.slice(0, 4)) + 1 : 1;
  return { snapshots, next: join(dir, `${String(number).padStart(4, "0")}.json`), latest };
}

function runSchemaCommand(command: "generate" | "lock" | "check", rest: string[], args: Args, io: Io, format: Format): number {
  const reporter = new Reporter();
  if (rest.length !== 1) {
    io.err(`error: \`${command}\` takes one schema file\n\n${USAGE}`);
    return 2;
  }
  const schemaPath = resolve(io.cwd, rest[0]!);
  const file = readSource(io, schemaPath, reporter);
  if (!file) return finish(reporter, io, format);
  const schema = loadSchema(file, reporter, snake(basename(schemaPath).replace(/\.prism$/, "")));
  const kind = args.values.get("kind")?.[0];
  if (kind !== undefined) {
    if (kind !== "player" && kind !== "memory") {
      io.err('error: --kind is "player" or "memory"');
      return 2;
    }
    schema.settings.kind = kind as StoreKind;
  }
  const modules = projectModules(dirname(schemaPath));
  if (!reporter.hasErrors) checkReservedNames(schema, modules, reporter);
  const history = readHistory(io, schemaPath, reporter);
  if (!reporter.hasErrors) compareHistory(schema, history.snapshots, reporter);
  if (command === "check" && !reporter.hasErrors) {
    const against = args.values.get("against") ?? [];
    if (against.length > 0) {
      const files = against.map((p) => readSource(io, p, reporter)).filter((f): f is SourceFile => f !== undefined);
      if (!reporter.hasErrors) checkAgainst(schema, scanVerse(files), reporter);
    }
  }
  if (reporter.hasErrors) return finish(reporter, io, format);
  if (command === "lock") return writeSnapshot(schema, history, reporter, io, format);
  if (command === "check") {
    report(reporter, io, format);
    io.out(`${display(io, schemaPath)}: ok`);
    return 0;
  }
  return writeGenerated(schema, file.text, schemaPath, args, reporter, io, modules, format);
}

function writeSnapshot(schema: Schema, history: { next: string; latest: string | undefined }, reporter: Reporter, io: Io, format: Format): number {
  const text = serializeSnapshot(buildSnapshot(schema));
  report(reporter, io, format);
  if (history.latest === text) {
    io.out("the published shape is unchanged: nothing to record");
    return 0;
  }
  mkdirSync(dirname(history.next), { recursive: true });
  writeFileSync(history.next, text);
  io.out(`recorded the published shape in ${display(io, history.next)}; commit it with your release`);
  return 0;
}

function writeGenerated(schema: Schema, schemaText: string, schemaPath: string, args: Args, reporter: Reporter, io: Io, modules: ReadonlySet<string>, format: Format): number {
  const outDir = resolve(io.cwd, args.values.get("out")?.[0] ?? dirname(schemaPath));
  let lib = args.values.get("lib")?.[0] ?? schema.settings.lib ?? detectLib(dirname(schemaPath));
  if (!lib) {
    lib = "Lib.Prism";
    reporter.warning("P901", "the Prism runtime wasn't found near the schema; using `Lib.Prism`", undefined, {
      help: "install it with `prism-verse init <dir>`, or set `lib` in the generator block",
    });
  }
  const files = generate(schema, { lib, schemaName: basename(schemaPath), schemaHash: schemaHash(schemaText), reserved: modules });
  const stale = files.filter((f) => {
    const path = join(outDir, f.name);
    return !existsSync(path) || readFileSync(path, "utf8") !== f.text;
  });
  if (args.flags.has("check")) {
    report(reporter, io, format);
    if (stale.length === 0) {
      io.out(`${display(io, schemaPath)}: generated files are up to date`);
      return 0;
    }
    io.err(`error: generated files are out of date: ${stale.map((f) => display(io, join(outDir, f.name))).join(", ")}\n  = help: run \`prism-verse generate ${display(io, schemaPath)}\``);
    return 1;
  }
  const written: string[] = [];
  for (const f of stale) {
    const path = join(outDir, f.name);
    try {
      writeFileSync(path, f.text);
      written.push(display(io, path));
    } catch (e) {
      reporter.error("P902", `can't write ${display(io, path)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  report(reporter, io, format);
  if (reporter.hasErrors) return 1;
  io.out(written.length > 0 ? `wrote ${written.join(", ")}` : `${display(io, schemaPath)}: generated files are up to date`);
  return 0;
}

// Verse modules of the project (folders under the content root): their names are reserved package-wide.
export function projectModules(from: string): Set<string> {
  const names = new Set<string>();
  let dir = resolve(from);
  let root: string | undefined;
  for (;;) {
    if (basename(dir).toLowerCase() === "content") root = dir;
    else if (readdirSync(dir).some((n) => n.endsWith(".uefnproject")) && existsSync(join(dir, "Content"))) root = join(dir, "Content");
    if (root) break;
    const parent = dirname(dir);
    if (parent === dir) return names;
    dir = parent;
  }
  // Only folders holding .verse files: an asset-only folder (tested) doesn't reserve its name.
  const walk = (d: string, depth: number): void => {
    if (depth > 12) return;
    for (const n of readdirSync(d)) {
      if (n.startsWith(".") || n.startsWith("__")) continue;
      const p = join(d, n);
      if (!statSync(p).isDirectory()) continue;
      if (readdirSync(p).some((f) => f.endsWith(".verse"))) names.add(n);
      walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return names;
}

function runImport(rest: string[], args: Args, io: Io, format: Format): number {
  const reporter = new Reporter();
  if (rest.length === 0) {
    io.err(`error: \`import\` takes the Verse files that declare your persistable classes\n\n${USAGE}`);
    return 2;
  }
  const files = rest.map((p) => readSource(io, p, reporter)).filter((f): f is SourceFile => f !== undefined);
  if (reporter.hasErrors) return finish(reporter, io, format);
  const text = importSchema(scanVerse(files), files.map((f) => basename(f.name)), reporter);
  if (reporter.hasErrors) return finish(reporter, io, format);
  report(reporter, io, format);
  const out = args.values.get("out")?.[0];
  if (out) {
    writeFileSync(resolve(io.cwd, out), text);
    io.out(`wrote ${display(io, resolve(io.cwd, out))}`);
  } else io.out(text.trimEnd());
  return 0;
}

function runExplain(rest: string[], io: Io): number {
  const code = rest[0]?.toUpperCase();
  const info = code ? CODES[code] : undefined;
  if (!code || !info) {
    io.err(`error: unknown code${code ? ` \`${code}\`` : ""}; codes are listed in docs/errors.md`);
    return 2;
  }
  io.out(`${code}: ${info.title}${info.fix ? `\n\nFix: ${info.fix}` : ""}\n\nAll codes: https://github.com/simnJS/prism-verse/blob/main/docs/errors.md`);
  return 0;
}

function runInit(rest: string[], args: Args, io: Io): number {
  if (rest.length !== 1) {
    io.err(`error: \`init\` takes the folder to install into, e.g. Content/Verse/Lib/Prism\n\n${USAGE}`);
    return 2;
  }
  const target = resolve(io.cwd, rest[0]!);
  const result = init(target, { demo: args.flags.has("demo"), sync: args.flags.has("sync") });
  if (result.conflicts.length > 0) {
    io.err(`error: these files differ from the runtime of prism-verse ${VERSION}:\n${result.conflicts.map((c) => `  ${display(io, c)}`).join("\n")}\n  = help: run again with --sync to overwrite them`);
    return 1;
  }
  for (const w of result.written) io.out(`wrote ${display(io, w)}`);
  if (result.written.length === 0) io.out("runtime already up to date");
  io.out(`\nDeclare the folder in the modules.verse of ${display(io, dirname(target))}:\n    ${result.modulesHint}`);
  return 0;
}

function finish(reporter: Reporter, io: Io, format: Format): number {
  report(reporter, io, format);
  return reporter.hasErrors ? 1 : 0;
}
