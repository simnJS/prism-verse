# Changelog

## 0.3.0 (2026-10-04)

- **Short saved names.** Each saved field of a model is saved under a name of one or two characters, derived from a
  hash of its schema name: reordering fields changes nothing, and a name is never a Verse keyword, a built-in or a
  module of the project. The model's API doesn't change. The record's own fields carry the short names; read and
  write them with `Get<Field>()` and `With<Field>(V)`, named after the schema fields. On the SellThings save, the 35
  saved names shrink from 385 characters to 46.
- `prism/<schema>/names.json` records the names: commit it. A new field never takes an existing name, and the name
  of a removed field stays reserved. `generate --check` fails when the file is out of date, and an unreadable one
  stops generation (`P109`).
- Published shapes record each field's API name next to its saved name, so `lock` freezes the names. Renaming a
  published field needs `@map` with its saved name, and `P101` prints the line to write. Shapes published by 0.2
  keep their readable names.
- `@map` still picks a name, `names = "long"` in the `generator` block saves the schema names, and `import` puts
  `@map` on every model field so an adopted format never moves.
- **Flattening.** A single field of a flat type held by a model is saved as fields of the record, without an object.
  A published object that would now be flattened or split into columns is reported (`P101`, `P104`) with the
  `@@rows` that keeps it.
- New command: `prism-verse names <schema>` prints the table; `lock` prints it too.
- Upgrading an unpublished 0.2 schema moves its saved names to short ones, so data saved under the 0.2 names during
  development is not read back. Set `names = "long"` to keep it (and `@@rows` on a type held as a single field).
- Examples: `migration` shows the rename on top of a published shape, `measure` compares readable and short names
  in the self-test, and the coverage fixture adds a flattened field and an option of a flat type.

## 0.2.1 (2026-10-04)

- `ChangedFields` holds the fields of the batch that `Changed` signals, so a listener can wake once per batch and
  skip the changes it doesn't show.

## 0.2.0 (2026-10-04)

- **Lists in columns.** A list of a flat type held by a model (only `Int`, `Float`, `Bool`, `String` and enum fields)
  is saved as one array per field instead of one object per item, without Verse's per-object metadata. The model's
  API doesn't change. `@@rows` keeps objects for a format already published, and `import` adds it. Measured in a
  live session: a mine takes 208 bytes as an object and 29 bytes in columns, so 7× more fit in the same save.
- New warnings: `P042` (a list saved as objects because its type isn't flat), `P043` (`@@rows` without a published
  shape that needs it).
- `prism_runner.FlushSeconds` defaults to 1 s: a changed player is written at most once per second; `Commit` still
  writes at the next tick.
- `Push` on a list with `@maxItems` and `@trim(head)` drops the oldest item instead of failing (rolling history).
- `PrismSize` follows the column format exactly; the upper-bound test covers columns.
- Examples: the quickstart caps its history, `sellthings` is the real game's clean save in columns, `migration`
  shows a `@@migrate` step, and `measure` compares objects and columns in the self-test.

## 0.1.0 (unreleased)

First version.

- Schema language: `model`, `type`, `enum`; `Int`, `Float`, `Bool`, `String`, enums, types, lists and options;
  persisted defaults, `@initial`, `@map`, `@min`, `@max`, `@maxItems`, `@trim`, `@where`, `@valid`, `@id`,
  `@counter`, `@item`, `@version` with `@@migrate`, `@lastSeen`, `@firstSeen`, `@saveCount`, `@deprecated`,
  `@transient`, `@@map`, `@@store`, `@@onLoad`.
- Generated Verse: persistable records with copy helpers, a tracked model with setters and change events, a store
  with write-through saving, commits, a size guard, trimming, migrations and a read-only mode for newer saves.
- Runtime: `prism_runner` (lifecycle) and `prism_store`.
- CLI: `init`, `generate` (`--check`), `lock` (published shapes), `check` (`--against`), `import`, `explain`;
  `--format text|json|github`.
