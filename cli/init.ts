import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface InitResult {
  written: string[];
  unchanged: string[];
  conflicts: string[];
  modulesHint: string;
}

export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

// Copies the Verse runtime (and optionally the demo) into a project folder.
export function init(target: string, options: { demo: boolean; sync: boolean }): InitResult {
  const root = packageRoot();
  const result: InitResult = { written: [], unchanged: [], conflicts: [], modulesHint: "" };
  const plan: [string, string][] = [];
  const runtime = join(root, "runtime", "Prism");
  for (const name of verseFiles(runtime)) plan.push([join(runtime, name), join(target, name)]);
  if (options.demo) {
    for (const example of ["quickstart", "sellthings"]) {
      const dir = join(root, "examples", example);
      for (const name of verseFiles(dir)) plan.push([join(dir, name), join(target, "PrismDemo", name)]);
    }
  }
  for (const [from, to] of plan) {
    const text = readFileSync(from, "utf8");
    if (existsSync(to)) {
      const current = readFileSync(to, "utf8");
      if (current === text) {
        result.unchanged.push(to);
        continue;
      }
      if (!options.sync) {
        result.conflicts.push(to);
        continue;
      }
    }
    result.written.push(to);
  }
  if (result.conflicts.length > 0) return result;
  for (const [from, to] of plan) {
    if (!result.written.includes(to)) continue;
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, readFileSync(from, "utf8"));
  }
  const folder = basename(resolve(target));
  result.modulesHint = `${folder}<public> := module:`;
  return result;
}

function verseFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".verse")).sort();
}

// Finds the installed runtime and the `using` path that reaches it from the schema's folder.
export function detectLib(schemaDir: string): string | undefined {
  let dir = resolve(schemaDir);
  for (;;) {
    for (const candidate of [dir, join(dir, "Prism"), join(dir, "Lib", "Prism")]) {
      if (existsSync(join(candidate, "prism_runner.verse"))) return usingPath(resolve(schemaDir), candidate);
    }
    const parent = dirname(dir);
    if (parent === dir || existsSync(join(dir, "Content")) || /\.uefnproject$/.test(readdirSync(dir).join("\n"))) return undefined;
    dir = parent;
  }
}

function usingPath(from: string, runtime: string): string {
  const a = from.split(/[\\/]/);
  const b = runtime.split(/[\\/]/);
  let i = 0;
  while (i < a.length && i < b.length && a[i]!.toLowerCase() === b[i]!.toLowerCase()) i++;
  const rest = b.slice(i);
  return rest.length === 0 ? b[b.length - 1]! : rest.join(".");
}
