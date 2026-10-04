import type { Reporter } from "./diagnostics.ts";
import { persistedDefaultOf, verseTypeOf } from "./generate.ts";
import { persistedFields, type ModelDecl, type Schema, type TypeDecl } from "./schema.ts";
import type { SourceFile, Span } from "./source.ts";
import { normalizeValue, type Scan } from "./verse_scan.ts";

// Compares the persisted shape of the schema with existing Verse persistable classes.
export function checkAgainst(schema: Schema, scan: Scan, reporter: Reporter): void {
  const at = (span: Span): { file: SourceFile; span: Span } => ({ file: schema.file, span });
  const where = (file: SourceFile, span: Span): string => `${file.name}:${file.position(span.start).line}`;
  const decls: (ModelDecl | TypeDecl)[] = [...schema.models, ...schema.types];
  for (const d of decls) {
    const cls = scan.classes.find((c) => c.name === d.recordClass);
    if (!cls) {
      const known = scan.classes.map((c) => `\`${c.name}\``).join(", ");
      reporter.error("P201", `record class \`${d.recordClass}\` is not in the Verse files`, at(d.node.name.span), {
        help: known ? `the files declare ${known}; set \`@@map\` to one of them` : "pass the files that declare the persistable classes",
      });
      continue;
    }
    const verseFields = new Map(cls.fields.map((f) => [f.name, f]));
    for (const f of persistedFields(d)) {
      const vf = verseFields.get(f.persisted);
      if (!vf) {
        reporter.error("P202", `\`${f.persisted}\` is not a field of \`${cls.name}\` (${where(cls.file, cls.span)})`, at(f.node.name.span), {
          help: f.persisted === f.name ? "if the saved name differs, set `@map(\"SavedName\")`" : "check the `@map` name",
        });
        continue;
      }
      verseFields.delete(f.persisted);
      const type = verseTypeOf(schema, f.type);
      if (type !== vf.type) {
        reporter.error("P203", `\`${f.persisted}\` is \`${type}\` in the schema but \`${vf.type}\` in ${where(cls.file, vf.span)}`, at(f.node.type.span));
        continue;
      }
      const def = normalizeValue(persistedDefaultOf(schema, f));
      const verseDefault = vf.default === undefined ? undefined : normalizeValue(vf.default);
      if (verseDefault !== def) {
        reporter.error("P204", `default of \`${f.persisted}\` is \`${def}\` in the schema but \`${verseDefault ?? "(none)"}\` in ${where(cls.file, vf.span)}`, at((f.def ?? f.node.name).span), {
          help: "persisted defaults must match exactly; give new players another value with `@initial`",
        });
      }
    }
    for (const extra of verseFields.values()) {
      reporter.error("P205", `\`${cls.name}.${extra.name}\` (${where(cls.file, extra.span)}) is not declared in the schema`, at(d.node.name.span), {
        help: `add it to \`${d.name}\`, as \`@deprecated\` if the game no longer uses it`,
      });
    }
  }
  for (const m of schema.models) {
    const store = scan.stores.find((s) => s.name === m.storeVar);
    if (!store) {
      const candidates = scan.stores.filter((s) => s.value.endsWith(m.recordClass)).map((s) => s.name);
      reporter.error("P206", `store variable \`${m.storeVar}\` is not in the Verse files`, at(m.node.name.span), {
        help: candidates.length > 0 ? `set \`@@store("${candidates[0]}")\`` : "pass the file that declares the weak_map",
      });
      continue;
    }
    const expected = schema.settings.kind === "player" ? { key: "player", value: m.recordClass } : { key: "session", value: `[player]${m.recordClass}` };
    if (store.value !== expected.value && !(store.key === "player" && store.value === m.recordClass)) {
      reporter.error("P206", `\`${m.storeVar}\` holds \`${store.value}\`, not \`${m.recordClass}\``, at(m.node.name.span));
    } else if (store.key !== expected.key) {
      reporter.warning("P206", `\`${m.storeVar}\` is a \`${store.key}\` map in the Verse files but the schema kind is "${schema.settings.kind}"`, at(m.node.name.span), {
        help: "expected when checking a memory-mode copy against a published game",
      });
    }
  }
}
