# prism-verse

**Typed player data for UEFN Verse.** Write your player save once, in a small schema. Prism generates the Verse code
that loads, validates, migrates and saves it, and refuses any edit that would break saves you have already published.

> **Status: alpha.** Generated code verified with UEFN 42.30: compile, BuildAll and a self-test in a live session
> (0.1: 29 checks; the 0.2 run is next).

```
save.prism ──prism-verse generate──▶ player_save_records.verse   the persisted contract
                                     player_save_model.verse     the model your game uses
                                     player_save_store.verse     load, validate, migrate, save
```

## Why

Verse saves player data in a `weak_map(player, record)` of immutable classes. Everything around it is hand-written:
the persisted class, an in-memory class, a save function and a load function, so each field lives in four places.
The mistakes are silent:

- **Forget a field in the save function.** It compiles, and the field resets to its default at every save.
- **Rename a persisted field.** UEFN refuses the session with "not backward compatible", and you hunt for the cause.
- **Let a list grow past 256 KB.** The write is a runtime error, or your size guard silently skips every save after.

Prism generates the four places from one schema, checks every edit against what you published, and guards every
write. It also saves lists compactly: Verse's format repeats about 200 bytes of metadata for every object in a list,
so Prism saves a list of flat items as one array per field ("columns") and rebuilds the objects on load.

## Install

```
npm install -g github:simnJS/prism-verse
```

Requires Node 22.18 or later.

## Quickstart

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

**3. Generate.** Three `.verse` files appear next to the schema, in the same module as your game.

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

**6. When you publish**, record the published shape. From then on, `generate` refuses any edit that would break it.

```
prism-verse lock Content/Verse/Game/save.prism
```

## Migrations

Published fields can't be removed or retyped. When one changes meaning, keep it as `@deprecated` and convert it in a
plain Verse function. Here, money was an `Int` saved as `Coins` and became a `Float` saved as `Money`
([examples/migration](examples/migration)):

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

## How saving works

- A changed player is written at most once per second (`FlushSeconds`, 0 for every tick), so a crash loses at most
  one second. `Commit()` writes at the next tick: use it for purchases and rare drops.
- Lists of flat items (only `Int`, `Float`, `Bool`, `String` and enum fields) are saved in columns. `@@rows` on a type
  keeps one object per item, for a format you already published.
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
  [migration](examples/migration), and the objects-versus-columns [measure](examples/measure) used by the self-test.
- [Contributing](CONTRIBUTING.md).

## License

MIT © 2026 simnJS
