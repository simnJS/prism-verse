# Changelog

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
