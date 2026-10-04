# Changelog

## 0.2.1 (unreleased)

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
