# Patterns

Ways to use Prism for common needs. Nothing here is extra code in Prism: these are schema and game-code choices.

## Purchases

**Entitlements are the source of truth.** For a durable purchase (a pass, a cosmetic), don't copy it into the save:
read `GetPurchasedEntitlements` and listen to `GetEntitlementsChangedEvent`. A copy can only drift.

**Consumables** (a pack of gems) need a save write, and the purchase and the write can't be one atomic operation.
Write the grant and a *pending* marker in the same record, then consume the entitlement, then clear the marker:

```prisma
model PlayerSave {
  Gems           Int    @min(0)
  PendingGrants  String[] @maxItems(16)   // offer ids granted but not yet consumed
}
```

1. In one transaction: add the gems, push the offer id to `PendingGrants`, `Commit()`.
2. Consume the entitlement.
3. Once it succeeds, delete the id from `PendingGrants`.
4. In `@@onLoad`, retry the consumption for every id still pending.

A crash between two steps never grants twice and never loses a paid grant.

## Hot and cold data

Each write serializes the **whole** record. When a save mixes values that change every tick (coins) with large
collections that rarely change (an album of 500 items), split it into two models. Each model has its own store and
its own record, so a coin change no longer rewrites the album:

```prisma
model PlayerHot {
  Coins Float @min(0.0)
  Level Int   @min(1)
}

model PlayerCollection {
  Items Item[] @maxItems(500)
}
```

This uses two of the four persistent maps an island has. Run both stores in one runner:
`prism_runner{Stores := array{PlayerHotStore, PlayerCollectionStore}}`.

## Offline earnings

Add a `@lastSeen` field and a load hook. `OfflineSeconds` holds the time since the last save, and the heartbeat
keeps it accurate even for idle players:

```prisma
model PlayerSave {
  Coins    Float @min(0.0)
  LastSeen Float @lastSeen

  @@onLoad(CreditOffline)
}
```

Cap the credited time in `CreditOffline`: the clock of a crash or of a long outage is not play time.

## Blocked saves

When a record no longer fits even after trimming, Prism keeps the last saved record and signals `SaveBlocked`. The
game should tell the player, or stop the growth that caused it:

```verse
WatchBlockedSaves(Save:player_save)<suspends>:void =
    loop:
        Reason := Save.SaveBlocked.Await()
        if (Reason = prism_block.TooLarge):
            Print("This save no longer fits in the player map")
```

The CLI warns about this ahead of time: `P041` for lists without `@maxItems`, `P040` when the caps allow more than
256 KB.

## Golden records

Keep, in a memory-mode test, one record of every version you shipped, and check that each one migrates and loads
into the values you expect (`Rec.PrismMigrated()`, then `LoadRecord`). The demo's `prism_selftest_component` does
this for SellThings' versions 1, 2 and 3.
