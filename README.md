# prism-verse

Typed player data for UEFN Verse: one schema, generated persistence, migrations and a lock that refuses breaking changes.

## What it is

Write your player save once, in a small schema. Prism generates the Verse code
that loads, validates, migrates and saves it, and refuses any edit that would break saves you have already published.

> **Status: alpha.** Generated code verified with UEFN 42.30: compile and BuildAll for 0.3, and a 33-check self-test
> in a live session for 0.2.

```
save.prism ──prism-verse generate──▶ player_save_records.verse   the persisted contract
                                     player_save_model.verse     the model your game uses
                                     player_save_store.verse     load, validate, migrate, save
```

### Why

Verse saves player data in a `weak_map(player, record)` of immutable classes. Everything around it is hand-written:
the persisted class, an in-memory class, a save function and a load function, so each field lives in four places.
The mistakes are silent:

- **Forget a field in the save function.** It compiles, and the field resets to its default at every save.
- **Rename a persisted field.** UEFN refuses the session with "not backward compatible", and you hunt for the cause.
- **Let a list grow past 256 KB.** The write is a runtime error, or your size guard silently skips every save after.

Prism generates the four places from one schema, checks every edit against what you published, and guards every
write. It also saves lists compactly: Verse's format repeats about 200 bytes of metadata for every object in a list,
so Prism saves a list of flat items as one array per field ("columns") and rebuilds the objects on load. Measured in
a live session: a mine takes 208 bytes as an object and 29 bytes in columns, so 7× more fit in the same save. Saved
field names are one or two characters, and your code never sees them.

## Features

- One `.prism` schema generates three Verse files: the persisted records, the model your game uses, and the store
  that loads, validates, migrates and saves
- `lock` records the published shape; from then on `generate` refuses any edit that would break published saves,
  and saved field names are frozen
- Migrations through `@deprecated` fields and `@@migrate` with a plain Verse function
- Compact saves: lists of flat items are saved in columns, and saved field names are one or two characters
- Write guards: at most one write per second per changed player, `Commit()` for immediate writes, size checks that
  never send an oversized write, and `@trim` for lists
- `import` turns existing persistable Verse classes into a schema, and `check` compares a schema against published
  Verse files
- Error codes with explanations (`prism-verse explain <code>`), with text, JSON and GitHub output formats

## Getting started

### Prerequisites

- Node 22.18 or later
- A UEFN project

### Install

```
npm install -g github:simnJS/prism-verse
```

### Usage

**1. Add the Verse runtime** to your project (once). It prints the line to add to your `modules.verse`.

```
prism-verse init Content/Verse/Lib/Prism
```

**2. Write a schema**, for example `Content/Verse/Game/save.prism`:

```prisma
datasource {
  kind = "player"
}

generator {
  prefix = "player_save"
}

model PlayerSave {
  Version     Int   = 1   @version
  Coins       Float = 0.0 @min(0.0)
  Level       Int   = 1   @min(1) @max(100)
  Cards       Card[]      @maxItems(50)
  NextCard    Int   = 1   @counter(Cards.Uid)
  RecentDrops Int[]       @maxItems(100) @trim(head)
  LastSeen    Float = 0.0 @lastSeen
  Selected    Int   = -1  @transient
}

type Card {
  Uid    Int  = 0 @id
  Kind   Int  = 0
  Golden Bool = false
}
```

**3. Generate.** Three `.verse` files appear next to the schema, in the same module as your game, with
`prism/save/names.json`: the short name each field is saved under. Commit it, as you would commit Prisma migrations.

```
prism-verse generate Content/Verse/Game/save.prism
```

**4. Start saving** from a device placed in your level:

```verse
save_device := class(creative_device):
    OnBegin<override>()<suspends>:void =
        prism_runner{Stores := array{PlayerSaveStore}}.Run(GetPlayspace())
```

**5. Use the data.** Setters are `<transacts>`: a failed purchase rolls back its changes and its `Commit`.

```verse
ReadmeUsage(Player:player):void =
    if (Save := Player.GetPlayerSave[]):
        Save.AddCoins(25.0)
        Uid := Save.TakeNextCard()
        if (Save.UpsertCard[card{Uid := Uid, Kind := 3}]):
            Save.Commit()
```

**6. When you publish**, record the published shape. From then on, `generate` refuses any edit that would break it,
and the saved names are frozen.

```
prism-verse lock Content/Verse/Game/save.prism
```

## CLI reference

```
prism-verse init <dir> [--demo] [--sync]       copy the Verse runtime into your project
prism-verse generate <schema> [--check]        write the Verse files next to the schema
prism-verse lock <schema>                      record the published shape (run it when you publish)
prism-verse check <schema> [--against <file.verse>...]
prism-verse import <file.verse>... [--out <schema>]
prism-verse names <schema>                     the saved name (short code) of every field
prism-verse explain <code>                     what an error code means and how to fix it
```

| Option | Meaning |
| :--- | :--- |
| `--check` | Fail instead of writing when generated files are out of date (`generate`) |
| `--format text\|json\|github` | Output format |
| `--lib <path>` | Module path of the runtime in `using` (default: found near the schema) |
| `--kind memory\|player` | Override `datasource.kind` |
| `-v`, `--version` | Print the version |

## Migrations

Published fields can't be removed or retyped. When one changes meaning, keep it as `@deprecated` under its saved
name and convert it in a plain Verse function. Here, `Coins` was an `Int` saved as `l` (`prism-verse names` prints
it) and becomes a `Float` ([examples/migration](examples/migration)):

```prisma
model Wallet {
  Version     Int   = 1 @version
  LegacyCoins Int   @map("l") @deprecated
  Coins       Float @min(0.0)

  @@migrate(2, MoneyToFloat)
}
```

```verse
MoneyToFloat(Rec:wallet_record)<transacts>:wallet_record =
    Rec.WithCoins(1.0 * Max(Rec.GetLegacyCoins(), 0))
```

## How saving works

- A changed player is written at most once per second (`FlushSeconds`, 0 for every tick), so a crash loses at most
  one second. `Commit()` writes at the next tick: use it for purchases and rare drops.
- Lists of flat items (only `Int`, `Float`, `Bool`, `String` and enum fields) are saved in columns, and a single flat
  item as fields of the record. `@@rows` on a type keeps objects, for a format you already published.
- Each saved field gets a name of one or two characters (`Coins` is saved as `l`). It never moves when you reorder
  or add fields, `lock` freezes it, and `@map("Name")` picks your own.
- Nothing is written before the first real change, so a failed load can never overwrite real data with defaults.
- Prism never relies on a save when a player leaves: UEFN doesn't guarantee it.
- An oversized write never reaches the server. Lists marked `@trim` are cut; otherwise the last good save is kept.

Good to know: **rolling back an island wipes all player data**, and an island has at most 4 persistent maps of
256 KB per player each (Epic's documentation, see [docs/research.md](docs/research.md)).

## When not to use it

- A tiny save that will never change (a few counters): a hand-written class is simpler.
- Data that isn't per player, such as leaderboards or island-wide state: Verse can't persist it.

## Docs

- [Guide](docs/guide.md): schema reference, generated API, saving, published shapes, adopting Prism in a published
  game, CLI, testing.
- [Error codes](docs/errors.md), [patterns](docs/patterns.md) (purchases, hot/cold split) and
  [design research](docs/research.md).
- [examples/](examples): the quickstart, the save of a real tycoon game ([sellthings](examples/sellthings)), a
  [migration](examples/migration), and the [measures](examples/measure) of the self-test (objects versus columns,
  readable versus short names).
- [Changelog](CHANGELOG.md).

## Development

```
npm ci
npm run typecheck   # tsc --noEmit, strict
npm test            # node:test, runs the TypeScript sources directly (Node 22.18+)
npm run build       # dist/prism.js, a single file with no dependency
```

`npm run examples` regenerates the Verse files of `examples/`. See [Contributing](CONTRIBUTING.md) for the test
suites and how to verify generated code in UEFN.

## Tech stack

- TypeScript CLI (Node 22.18+), bundled into a single file with esbuild
- Verse runtime (`runtime/Prism`) copied into the UEFN project by `prism-verse init`
- Tests with `node:test`; CI on GitHub Actions (Ubuntu and Windows, Node 22 and 24)

## License

MIT © 2026 simnJS, see [LICENSE](LICENSE).
