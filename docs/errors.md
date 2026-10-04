# Prism error codes

Every diagnostic has a code, the schema position and, when there is an obvious fix, a `help:` line.

```
save.prism:7:20 error[P012]: unknown type `PlacedMines`
  |
7 |   Mines        PlacedMines[]
  |                ^^^^^^^^^^^ no model, type or enum has this name
  = help: did you mean `PlacedMine`?
```

## Syntax (P001–P009)

| Code | Meaning |
|---|---|
| P001 | Unexpected character. |
| P002 | Unexpected token: the message says what was expected. |
| P003 | Unterminated string. |
| P004 | Unknown block: expected `datasource`, `generator`, `model`, `type` or `enum`. |
| P005 | Unknown setting in `datasource` or `generator`. |
| P006 | Invalid setting value (e.g. `kind` must be `"player"` or `"memory"`). |

## Schema (P010–P033)

| Code | Meaning |
|---|---|
| P010 | Two declarations (model, type, enum) share a name. |
| P011 | Two fields of one block share a name. |
| P012 | Unknown type. |
| P013 | Unknown attribute. |
| P014 | Attribute not allowed here (wrong field type or wrong block kind). |
| P015 | Invalid attribute argument. |
| P016 | Attribute given twice. |
| P017 | The default value doesn't match the field type. |
| P018 | Conflicting attributes (e.g. `@transient` with `@map`, `@deprecated` with `@initial`). |
| P019 | Two fields are saved under the same name, or two records under the same class name. |
| P020 | `@version`: an `Int` with a default, at most one per model, required when the model has `@@migrate`. |
| P021 | `@lastSeen` and `@firstSeen` are `Float` fields, `@saveCount` an `Int` field; at most one of each per model. |
| P022 | `@id`: an `Int` field of a type, at most one per type. |
| P023 | `@counter(List.Field)`: the list must exist in the same model and hold a type whose field is the `@id`. |
| P024 | `@@migrate(N, F)`: steps start at 2 and are unique. |
| P025 | More than 4 persistent stores (`kind = "player"`): UEFN allows 4 persistent maps per island. |
| P026 | A type contains itself. |
| P027 | Enum without values, or with a value twice. |
| P028 | Invalid identifier, Verse reserved word, or clash with a generated name. |
| P029 | Nested containers (`T[][]`, `T?[]`, `T[]?`) are not supported. |
| P030 | A model is used as a field type: models are roots, use a `type`. |
| P031 | `@min` is greater than `@max`. |
| P032 | The `@valid` fallback doesn't match the item type. |
| P033 | A field, enum value or generated name has the name of a Verse module (a folder) of the project: Verse reserves module names in the whole package. |

## Size warnings (P040–P041)

Warnings: generation still succeeds. Sizes are upper bounds of Verse's persistence JSON (see `cli/size.ts`), with
strings counted at 64 characters.

| Code | Meaning |
|---|---|
| P040 | The record can grow past the 256 KB player map limit. |
| P041 | A list has no `@maxItems` (and no `@trim`): its size is unbounded. |

## Published shapes: breaking changes (P101–P110)

Raised by `generate`, `check` and `lock` against every shape recorded in `prism/<schema>/`. Saves written by a
published version would be lost or misread.

| Code | Meaning | Usual fix |
|---|---|---|
| P101 | A persisted field was removed, renamed with `@map`, or made `@transient`. | Put it back with `@deprecated`, or restore its `@map` name. |
| P102 | A persisted field changed type. | Keep the old field (`@deprecated`), add a new one, migrate. |
| P103 | A persisted default changed. | Keep the old default; use `@initial` for new players. |
| P104 | A record class was renamed (`@@map`) or a type removed. | Restore the name with `@@map`. |
| P105 | An enum value was removed or renamed. | Keep it; add new values at the end. |
| P106 | A store variable was renamed (`@@store`) or a model removed. | Restore it with `@@store`. |
| P107 | `datasource.kind` changed. | Changing between memory and player is a new store, not an edit. |
| P108 | The version went down (a `@@migrate` step was removed). | Keep every step. |
| P109 | A recorded shape can't be read, comes from a newer Prism, or was edited by hand. | Restore it from version control. |
| P110 | A published `@@migrate` step was changed or removed. | Keep published steps; add a new step for a new conversion. |

## Check against Verse (P201–P206)

Raised by `check --against`.

| Code | Meaning |
|---|---|
| P201 | A record class of the schema is not in the Verse files. |
| P202 | A persisted field is missing from the Verse class. |
| P203 | A field type differs. |
| P204 | A field default differs. |
| P205 | The Verse class has a field the schema doesn't declare. |
| P206 | The store variable is missing or has another type. |

## Import (P301–P302)

| Code | Meaning |
|---|---|
| P301 | A persistable class couldn't be parsed. |
| P302 | A field type has no schema equivalent; the field is kept as a comment. |

## Files (P901–P902)

| Code | Meaning |
|---|---|
| P901 | File not found. |
| P902 | Output file can't be written. |
