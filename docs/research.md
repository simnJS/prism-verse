# Design research (October 2026)

Sourced findings behind Prism's defaults. Confidence tags: **[official]** Epic docs, **[epic-staff]** Epic forum
staff, **[community]** creator reports, **[unverified]** not confirmed.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Save mode | **Write-through by default**: a dirty player is written at the next tick (at most one write per player per tick). `FlushSeconds > 0` is an opt-in debounce. `Commit` forces a write in any mode. | Nothing official discourages frequent writes; nothing guarantees a later flush; a write after leaving is impossible. The flush interval *is* the loss window. |
| Leave / shutdown | Best effort only, gated on `IsActive[]`. Never relied on. | "If a player leaves… you can no longer store or access their data." [official] |
| Size guard | Never let an oversized write happen. Estimate the size in generated code, call `FitsInPlayerMap` only near the limit, trim `@trim` lists, else keep the last good record and raise an event. | An oversized write is a Verse runtime error, which can end the server [official/community]. `FitsInPlayerMap` was measured at 30–40 ms on a 1,000-int record [community]. |
| Join | Never write on load. A record is created by the first real change. Optional `SaveCount` / `FirstSeen` fields help diagnose resets. | Reset bugs on Epic's side keep recurring (2024–2026), and a default record written on join can overwrite real data if a load ever goes wrong. |
| Versions | The `@version` field's persisted default is the baseline (1); new records get the latest explicitly. Write back only after the whole migration chain and validation succeed. A record newer than the code goes read-only. | Old saves without a field load its default; old island versions can keep running during a rollout. |
| Lock | One snapshot per publish (`history/0001.json`…); only published shapes are compared, so unpublished edits are free. The migration list is checksummed. | UEFN's own check already runs at session launch, push and publish, with terse errors (3643, "not backward compatible"). Prism's value is clear messages, frozen defaults, migration integrity and CI. |
| Diagnostics | Rule IDs + severities (error/warn), all errors at once, `--format text\|json\|github`, `explain <code>`, `generate --check`, write-if-changed, LF, header with schema hash. | buf breaking, oasdiff, graphql-inspector, rustc/miette, sqlc / GraphQL Codegen. |

## UEFN facts

- 256 KB per player per persistent map; up to 4 persistent maps per island (raised from 2 in Aug 2025); the size
  limit applies per map. [official] https://dev.epicgames.com/documentation/en-us/fortnite/using-persistable-data-in-verse ·
  [epic-staff] https://forums.unrealengine.com/t/limit-on-number-of-verse-persistent-weak-maps-increased/2635179
- An oversized write: "the save will fail and you will get a Verse runtime error." [official]
- Integers serialize as 64-bit; outside that range serialization fails at runtime. https://verselang.github.io/book/17_persistable/
- Data loads during matchmaking; if it fails, the player cannot join. A missing entry should mean a new player. [official]
  Reset reports still exist: FORT-830274 (fixed, data restored), FORT-1040260 (not reproduced), FORT-1145748 (Aug 2026, in QA).
- Writes after leaving: "requires us building distributed transactional memory", so they are a runtime error.
  [epic-staff] https://forums.unrealengine.com/t/weak-map-invalid-key-runtime-error/1829753
- **Rolling back an island resets all player persistence data.** [official]
  https://forums.unrealengine.com/t/urgent-all-player-persistent-data-reset-after-roll-back-published-version/2726957
- Backward-compatibility check: runs on session launch, push and publish. Only add defaulted fields to classes;
  structs and closed enums are frozen; an enum used as a map key broke compatibility in 2024. Whether changing a
  default passes the check is undocumented. https://verselang.github.io/book/18_evolution/
- Testing: Island Settings → Persistence Behavior: "Import From Live" or "Simulate New User". No tool to inspect,
  back up or restore player data. [official / unverified]
- Not documented: serialization and upload timing, rate limits, flush on shutdown or crash.

## Lessons from Roblox and other platforms

- Cached copy + coalesced saves; immediate save at critical moments (ProfileStore `Save()` "for critical moments
  like … Developer Product purchases"). https://madstudioroblox.github.io/ProfileStore/api/
- Never overwrite real data with defaults when a load is uncertain (DataStore2 backup mode).
  https://kampfkarren.github.io/Roblox/advanced/backups/
- Versioned records + ordered migrations; read-only when data is newer than the code (Lapis).
  https://nezuo.github.io/lapis/docs/Migrations
- Purchases: in UEFN, entitlements are the source of truth (`GetPurchasedEntitlements`,
  `GetEntitlementsChangedEvent`). For consumables, write the grant and a pending marker in one record write, consume,
  then clear the marker. https://dev.epicgames.com/documentation/fortnite/in-island-transactions-overview-in-fortnite
- Hot/cold split: a small, often-written record and a large, rarely-written one in separate stores.
- Test with golden records of every shipped version, run through migrate + validate.

## Tooling prior art

- Breaking changes: buf (`FIELD_NO_DELETE`, `FIELD_SAME_TYPE`, `FIELD_SAME_DEFAULT`…) https://buf.build/docs/breaking/rules/ ·
  oasdiff severities and `--fail-on` · graphql-inspector breaking/dangerous/safe · Avro aliases for renames.
- Migrations: MongoDB schema-versioning pattern (lazy migrate on read), Room/Realm step chains with schema snapshots,
  expand and contract (https://martinfowler.com/bliki/ParallelChange.html), Prisma `@ignore` and migration checksums.
- Codegen: Go header `Code generated … DO NOT EDIT.`, golden snapshots, idempotence, `--check` mode, an IR export
  instead of a plugin system, documented eject.
- DX: rustc/miette diagnostics, error catalog with `explain`, TextMate grammar + `format` (LSP later), Diátaxis docs,
  changesets + npm trusted publishing, CI on windows-latest.
