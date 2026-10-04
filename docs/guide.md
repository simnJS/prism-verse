# Prism guide

The full reference. For a first look, start with the [README](../README.md).

- [Schema](#schema)
- [Migrations](#migrations)
- [Generated API](#generated-api)
- [Runtime](#runtime)
- [How saving works](#how-saving-works)
- [Published shapes](#published-shapes)
- [Already published?](#already-published)
- [CLI](#cli)
- [Testing](#testing)
- [Platform facts](#platform-facts)

## Schema

```prisma
datasource {
  kind = "player"              // "player": persistent weak_map(player, …) | "memory": weak_map(session), for tests
}

generator {
  prefix       = "player_save" // output files: <prefix>_records.verse, _model.verse, _store.verse
  methodPrefix = ""            // prefix of the generated methods, to avoid clashes with your own methods
  lib          = "Lib.Prism"   // runtime module path (default: found near the schema)
  using        = ["Balance"]   // modules holding the constants and functions the schema names
}

model PlayerState { … }        // a root: one persisted map, one in-memory model, one store
type  PlacedMine  { … }        // a record used inside a model (list item, option, field)
enum  Rarity { Common Rare Epic }
```

**The schema never contains Verse code.** Values are literals or names: `0`, `1.5`, `true`, `"text"`, `[-1, 2]`,
`none`, `MaxDrones` (a constant of your game), `Rarity.Epic`. Logic lives in Verse functions that the schema
names: validators, migrations, the load hook. Verse type-checks them, and the schema stays readable.

**Types:** `Int`, `Float`, `Bool`, `String`, an enum, a type, and `T[]` (list) or `T?` (option) of those. Enums
are generated `<open>`, so values can be added after publishing.

### Field attributes

| Attribute | On | Effect |
|---|---|---|
| `= value` | persisted field | Default in the record, used when an old save lacks the field. **Frozen once published.** |
| `@initial(value)` | any field | Value for a brand-new player, when it differs from the persisted default. |
| `@map("Name")` | persisted field | Field name in the saved data; the API keeps the schema name. |
| `@min(v)` `@max(v)` | `Int`, `Float` | Clamped on load and by every setter. |
| `@maxItems(n)` | list | Capped on load and by `Set`; `Push` fails when full, except on a `@trim(head)` list, where it drops the oldest item (a rolling history). |
| `@trim(head)` `@trim(tail, 2)` | list | When the record doesn't fit, drop items from that end, by priority (1 first). **Only for data you can afford to lose** (history, logs). |
| `@where(F)` | list | On load, keeps the items for which `F[It]` succeeds. |
| `@valid(F)` `@valid(F, v)` | scalar, scalar list | On load, a value for which `F[It]` fails becomes the default (or `v`). |
| `@id` | `Int` field of a type | Identity: lists of that type get `Find`, `Upsert`, `Delete`. |
| `@counter(List.Field)` | `Int` field | Next free id; repaired on load (at least max id + 1). Generates `Take<Field>()`. |
| `@item("Name")` | list | Singular used in method names (default: `Cards` gives `Card`). |
| `@version` | `Int` field of a model | Holds the schema version, written by Prism. Its default stays the version of the first published shape: use `1` for a new schema. |
| `@lastSeen` | `Float` field of a model | Save time; gives `OfflineSeconds` on load. |
| `@firstSeen` `@saveCount` | `Float` / `Int` field of a model | Time of the first save, number of saves: they help diagnose resets. |
| `@deprecated` | persisted field | Stays in the record for migrations; gone from the model; written as its default. |
| `@transient` | field of a model | In the model only, never saved. |

Validators are Verse functions of your game: `(It:T)<computes><decides>:void`, or `<transacts>` at most.

### Block attributes

| Attribute | On | Effect |
|---|---|---|
| `@@map("name")` | model, type | Verse class name of the record (default: `player_state_record`, `placed_mine`). |
| `@@store("Name")` | model | Name of the `weak_map` variable (default: `PlayerStateSaves`). |
| `@@onLoad(F)` | model | `F(Who:player, Model):void` runs once after each load (offline earnings, debug kits…). |
| `@@migrate(N, F)` | model | A record with `Version < N` goes through `F(Rec):record`, then gets `Version = N`. |
| `@@rows` | type | Saves the lists of this type as one object per item instead of columns (see below). |

The current version of a model is its highest `@@migrate` step (1 without migrations).

### Lists in columns

Verse saves every object with its package path, its class name and an `x_` key per field: about 200 bytes before
the first value. Prism therefore saves a list held by a model as **one array per field** when its type is flat (only
`Int`, `Float`, `Bool`, `String` and enum fields): `Mines PlacedMine[]` becomes `Mines_Id:[]int`, `Mines_X:[]float`
and so on in the record. The model still sees a list of `placed_mine` objects; only saving and loading convert.

- Adding a field to the type adds a column. Old saves lack it, and every item gets the field's default.
- Removing or retyping a field of the type is a breaking change, as for any saved field.
- A type with a list, an option or a nested type can't be split into columns: its lists are saved as objects, and
  `P042` says why. Lists inside a `type` are always objects.
- `@@rows` keeps objects on purpose, for a format you already published (`import` adds it for you). Without that
  reason, `P043` reminds you that columns are several times smaller.

### Verse pitfalls Prism catches

- A field named like a Verse module of your project (`P033`): Verse reserves module names in the whole package.
- A name that clashes with a built-in (`P028`): `Log`, `Round`, `player`… and macros like `profile`.
- More than 4 persistent stores (`P025`), nested containers (`P029`), records containing themselves (`P026`).
- Lists that can push the record past 256 KB (`P040`, `P041`), and lists saved as objects when they could be columns
  (`P042`, `P043`).

## Migrations

Persisted fields can only be added, never removed or retyped, so a change of meaning is a migration: mark the old
field `@deprecated` (it stays readable), add the new one, and name a Verse function that converts the record
([examples/migration](../examples/migration)):

```prisma
model Wallet {
  Version     Int   = 1 @version
  LegacyCoins Int       @map("Coins") @deprecated
  Coins       Float     @map("Money") @min(0.0)

  @@migrate(2, MoneyToFloat)
}
```

```verse
MoneyToFloat(Rec:wallet_record)<transacts>:wallet_record =
    Rec.WithMoney(1.0 * Max(Rec.Coins, 0))
```

Steps run in order on the persisted record (persisted names). The whole chain and the validation run before your
code sees the data. A migrated record is written back only after the next real change.

## Generated API

For `model PlayerSave` (names follow `@@map`, `@@store` and `methodPrefix`):

| Generated | What |
|---|---|
| `player_save_record`, `card` | The `<final><persistable>` classes, with `MakeX<constructor>` copies and `(R:x).With<Field>(V)` helpers. |
| `player_save` | The model. Fields are public to read and written only through setters, so changes are always tracked. |
| `SetCoins(V)`, `AddCoins(D)`, `ToggleX()` | Scalars: set (clamped), add, flip a `Bool`. All `<transacts>`. |
| `SetCards(L)` | Plural: the whole list. |
| `FindCard[Id]`, `UpsertCard[V]`, `DeleteCard[Id]` | Singular: one item of a list of a type with an `@id`. |
| `PushEntry[V]`, `SetEntryAt[I, V]`, `DeleteEntryAt[I]` | Singular: one item of any other list (`PushEntry(V)` never fails on a capped `@trim(head)` list). |
| `TakeNextCard()` | `@counter` fields: returns the next id and advances it. |
| `Changed`, `FieldChanged`, `Notify()` | Change events. Setters queue them, and the runner signals them every tick. |
| `SaveBlocked`, `ReadOnly`, `Dirty`, `OfflineSeconds` | Size block events, newer-save mode, unsaved changes, seconds since the last save. |
| `Commit()` | Write at the next tick, whatever `FlushSeconds`; rolled back with its transaction. |
| `(P:player).GetPlayerSave[]` | The loaded model, from the session cache. Safe in an `if` head. |
| `PlayerSaveStore` | `Acquire(P)` (load if needed), `FlushNow(P)`, `Close(P)`, `Reset(P)`. |

```verse
WatchCoins(Save:player_save)<suspends>:void =
    loop:
        Field := Save.FieldChanged.Await()
        if (Field = player_save_field.Coins):
            Print("Coins: {Save.Coins}")
```

## Runtime

| Name | What |
|---|---|
| `prism_runner` | `Run(Playspace)`: loads players on join, writes a changed player at most once per `FlushSeconds` (1 s), saved players every `HeartbeatSeconds`, and everyone when the round ends. |
| `prism_store` | The interface every generated store implements; one runner can drive several stores. |
| `prism_block` | Why a save was blocked (`TooLarge`). |
| `PrismOfflineSeconds`, `PrismNow`, `PrismLog`, `PrismInt64` | Small helpers. |

The variant for Scene Graph games:

```verse
save_component := class<final_super>(component):
    OnBeginSimulation<override>():void =
        (super:)OnBeginSimulation()
        if (RoundManager := Entity.GetFortRoundManager[]):
            RoundManager.SubscribeRoundStarted(RunRound)

    RunRound()<suspends>:void =
        if (Playspace := Entity.GetPlayspaceForEntity[]):
            prism_runner{Stores := array{PlayerSaveStore}}.Run(Playspace)
```

## How saving works

- **About every change, at a bounded cost.** A changed player is written at most once per `FlushSeconds` (1 s by
  default; 0 writes at every tick), so a crash loses at most one second of play.
- **`Model.Commit()` forces a write** at the next tick, whatever `FlushSeconds`. It is `<transacts>`:
  call it inside a purchase, and it is cancelled if the purchase fails. `Store.FlushNow(Player)` writes
  immediately, from ordinary code.
- **Nothing is written before the first real change.** Joining doesn't create a record. If a load ever goes
  wrong, defaults never overwrite real data.
- **A save at departure is not guaranteed** (the player may already be inactive or no longer a valid key), so
  Prism never relies on it.
- **A heartbeat** rewrites saved players every `HeartbeatSeconds` (60 s) and when the round ends, so `LastSeen`
  stays accurate for offline time.
- **A save newer than the code is read-only.** For example, an older island version still runs during a
  rollout. Prism loads the data, sets `ReadOnly`, logs it, and never writes for that player.
- **Size guard.** Each write first computes `PrismSize`, a safe upper bound of the serialized record that never
  underestimates it (a test checks this).
  - Up to 252 KB (the 256 KB limit minus a margin), the record is written directly.
  - Above, Prism calls `FitsInPlayerMap` once, because the bound is pessimistic and the record may fit. That call
    is slow (30–40 ms per thousand ints measured), so it happens at most every 5 s per player, and never on a
    bound above 1 MB.
  - If the record doesn't fit, Prism cuts the lists marked `@trim` by arithmetic on `PrismSize`, in one copy,
    without another serialization.
  - If it still doesn't fit, Prism keeps the last saved record, signals `SaveBlocked`, logs it and retries 10 s
    later.
  - No flush ever serializes the record more than twice (the check, then the write), and an oversized write never
    reaches the server.

Each write serializes the whole record synchronously, and writes in one transaction are coalesced. With the default
`FlushSeconds`, a value that changes every tick (passive income) costs one serialization per second per player, of
a record kept small by the columns.

## Published shapes

`prism-verse lock` records the persisted shape in `prism/<schema>/0001.json`, `0002.json`… Run it when you publish.
`generate`, `check` and `lock` compare the schema with **every** recorded shape. Edits you haven't published stay
free.

UEFN runs its own backward-compatibility check when you launch a session, push and publish. Prism adds:
- **Clear messages**: the field, the reason and the fix, in your editor, before the session starts.
- **Frozen defaults**: UEFN's check doesn't document whether changing a default passes.
- **Migration integrity**: a published `@@migrate` step can't be changed or removed (`P110`, checksummed).
- **CI**: `prism-verse check` and `generate --check` exit with 1, and `--format github` annotates pull requests.

```
save.prism:12:15 error[P103]: persisted default of `DroneCount` changed from `1` to `2`
   |
12 |   DroneCount Int = 2 @min(1)
   |                    ^ saves written before this field existed would load 2
   = help: keep `= 1`; use `@initial(2)` to give new players another value
```

## Already published?

Adopt Prism without touching existing saves:

1. `prism-verse import PlayerData/player_save.verse PlayerData/records.verse --out PlayerData/save.prism` writes a
   schema that reproduces your persistable classes. Its types get `@@rows`, because your saves hold objects.
2. `prism-verse lock PlayerData/save.prism` records that shape as published.
3. Improve the schema: rename fields in the API with `@map`, add validators, migrations and caps.
4. `prism-verse check PlayerData/save.prism --against PlayerData/player_save.verse PlayerData/records.verse` must
   report 0 differences.
5. `prism-verse generate`, then delete the hand-written classes. They are in the same module, so their identity
   doesn't change.

## CLI

| Command | What |
|---|---|
| `init <dir> [--demo] [--sync]` | Copies the Verse runtime (and the demos) into your project, and prints the `modules.verse` line. |
| `generate <schema> [--check]` | Writes the Verse files, only when their content changes. `--check` fails instead of writing. |
| `lock <schema>` | Records the published shape. |
| `check <schema> [--against a.verse …]` | Validates the schema against the published shapes and, with `--against`, against existing classes. |
| `import <a.verse …>` | Writes a schema from existing persistable classes. |
| `explain <code>` | What a code means and how to fix it. All codes: [errors.md](errors.md). |

`--format text|json|github` changes how diagnostics are printed. Generated files start with
`# Code generated by prism-verse … (sha256:…). DO NOT EDIT.` and use LF line endings.

## Testing

- **Memory mode.** `kind = "memory"` (or `generate --kind memory`) stores records in a session map. You can test
  without touching real saves or using one of the 4 persistent maps.
- **Reset.** `Store.Reset(Player)` gives a player a fresh save.
- **Persistence Behavior.** In Island Settings, choose "Import From Live" or "Simulate New User" for edit sessions.
- **Self-test.** `prism-verse init <dir> --demo` installs a demo with `prism_selftest_component`. Attach it to an
  entity and start a session: it prints PASS/FAIL for round trips, migrations, clamping, trimming and the store.

More patterns (purchases, hot/cold split, blocked saves): [patterns.md](patterns.md).

## Platform facts

From Epic's documentation and staff:
- **Rolling back an island resets all player persistence data.**
- 256 KB per player per persistent map, and up to 4 persistent maps per island (raised from 2 in August 2025).
- Writing a player's data after they leave is impossible.
- Reset bugs on Epic's side have recurred (2024–2026), and there is no tool to inspect, back up or restore player
  data.

Sources in [research.md](research.md).
