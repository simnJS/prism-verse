# Contributing

## Setup

```
npm ci
npm run typecheck   # tsc --noEmit, strict
npm test            # node:test, runs the TypeScript sources directly (Node 22.18+)
npm run build       # dist/prism.js, a single file with no dependency
```

## Tests

- `test/golden.test.ts`: generated Verse, byte for byte. After an intended change to the generator, refresh the
  goldens with `UPDATE_SNAPSHOTS=1 npm test`, then review the diff of `examples/` and `test/`.
- `test/errors.test.ts`: one case and a rendered snapshot per schema error.
- `test/lock.test.ts`: one test per breaking change.
- `test/roundtrip.test.ts`: `import` and `check` on SellThings' published classes.
- `test/size.test.ts`: `PrismSize` never underestimates the serialized record.
- `test/budget.test.ts`: a flush calls `FitsInPlayerMap` at most once, never in a loop; trimming is arithmetic.
- `test/docs.test.ts`: every Verse snippet of the docs exists word for word in `examples/`, and `docs/errors.md`
  matches the code catalog.

## Compiling in UEFN

The generated code must compile in a real project:

1. `node cli/bin.ts init <Project>/Content/Verse/Lib/Prism --demo --sync`, then compile (0 errors) and run
   BuildAll (some linker errors only appear there).
2. `test/fixtures/coverage` uses every feature in `player` mode. Copy its `.verse` files into `Lib/Prism/PrismDemo`,
   compile, run BuildAll, then **delete them**: they declare a persistent map.
3. In a session, attach `prism_selftest_component` to an entity: every line must read PASS.

## Style

Comments are rare and short; names carry the meaning. Generated Verse follows the same rule, because users read it.
