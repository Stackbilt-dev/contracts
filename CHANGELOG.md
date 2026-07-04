# Changelog

## 0.9.0 - 2026-07-04

### New Exports

- **`MigrationGeneratorOptions.existingColumnTypes`** — optional, keyed by column name, values are raw PRAGMA `table_info` type strings (`INT`, `VARCHAR(255)`, `DATETIME`, etc). `generateMigration()` now emits a `-- WARNING: possible type changes` comment when a shared column's production type and the contract's derived type have different SQLite type affinities. Compared by affinity, not string equality, so equivalent spellings don't false-positive.
- **`generateMigration()` rename detection** — when a removed column name is a close edit-distance match to a newly-added one, both the `ADD COLUMN` statement and the removed-column comment get a `-- possible rename …? review before applying` cross-reference. Heuristic only — never auto-renames; the safe additive `ADD COLUMN` path is unchanged either way.

Closes contracts#18.

## 0.8.0 - 2026-07-04

### New Exports

- **`ref(() => Contract, field)`** — `ref()` now also accepts a thunk, so a contract can express a self-referential FK against itself (e.g. `ref(() => GenerationJob, 'id')` inside `GenerationJob`'s own schema). The thunk is resolved lazily by generators after the module finishes evaluating, once the binding is initialized. Non-thunked `ref(Contract, field)` is unchanged. Closes contracts#22.
- **`ContractOperation.transition.guard`** — an optional `(entity: unknown) => true | string` precondition over sibling fields, checked in addition to the `from` state match. `generateRoutes()` emits a 409 `GUARD_FAILED` response when the guard returns a string; `generateTests()` emits a conformance test against a passing fixture plus an `it.todo` for the untested rejection case (the generator can't synthesize a failing entity from an arbitrary predicate). The guard receives the raw persisted row (snake_case columns), not the camelCase entity shape. Closes contracts#24.

## 0.7.0 - 2026-07-04

### Fixed

- **`generateSQL` / `generateMigration` — `columnOverrides` silently ignored.** Override lookup was keyed by the snake_case `ColumnDef.name`, but override keys are written against the schema's field names (commonly camelCase), so the lookup always missed — DB-level defaults like `CURRENT_TIMESTAMP` were silently dropped. Override keys are now normalized to snake_case before lookup, regardless of casing. Closes contracts#25.
- **`generateSQL` — boolean `DEFAULT` literal.** `z.boolean().default(false)` emitted `DEFAULT false` instead of the codebase-wide `0`/`1` convention for SQLite INTEGER columns. Closes contracts#26.

## 0.6.0 - 2026-06-17

### New Exports

- **`generateMigration(contract, { existingColumns })`** — ALTER TABLE diff mode. Diffs the contract schema against existing production column names and emits `ALTER TABLE ... ADD COLUMN ...` statements for new columns. Notes removed columns (D1 cannot DROP COLUMN) as comments. Returns a no-op comment when schema is already up to date. Unblocks all contracts from being used to evolve existing production tables. Closes contracts#18.
- **`UserContract`** — first-party user ownership primitive. Required by any contract using `ref(UserContract, 'id')` for ownership FK references. Exports `UserContract`, `UserStatus`, `UserTier`, `User`, `UserInput`. Closes contracts#19.
- **`generateApiTypes(contract)`** — emits a TypeScript type definition file with camelCase entity interface, per-operation input/output types, and route path constants. Closes contracts#20.
- **`toCamelCase(str)`** — inverse of `toSnakeCase`. Exported from both `@stackbilt/contracts` (main) and `@stackbilt/contracts/introspect`.

### Changed

- `@stackbilt/contracts/generators` now exports `generateMigration` and `generateApiTypes` alongside existing generators.
- `@stackbilt/contracts/introspect` now exports `toCamelCase` alongside `toSnakeCase`.

## 0.5.2 - 2026-06-13

### Changed

- **`ActTypeSchema`** — adds `cc_task_completion` to the enum. Used by AEGIS daemon to seal cc_task completions and failures into the audit-chain provenance ledger.

## 0.5.1 - 2026-06-12

### New Exports

- **`CognitiveAct`** — canonical act record for the AEGIS Total Provenance Ledger. Exports `ActTypeSchema`, `ActStatusSchema`, `CognitiveActInputSchema`, `CognitiveActRecordSchema`, `EmittedActSchema`, and the full ODD `CognitiveActContract` (use `generateSQL(CognitiveActContract)` to produce the D1 migration). Replaces inline type definitions in `aegis-daemon/provenance-bus.ts`.

## 0.5.0 - 2026-06-12

### New Exports

- **`PostureGate`** — named degradation signals → deterministic autonomy posture (NORMAL/ALT1/ALT2/DIRECT). Includes `PostureSchema`, `PostureSignalSchema`, `PostureGateResultSchema`, `evaluatePosture()`. Codifies a primitive appearing across ≥4 Stackbilt systems with no prior shared implementation.
- **`AttestationEnvelope`** — result + provenance binding (traceId, tenantId, ticketRef, model, cost, hmac) sealed for later verification. Includes `AttestationEnvelopeSchema`, `canonicalPayload()`. Canonical shape for stackd receipts, audit-chain entries, and reading-envelope bindings.
- **`TierSelector`** — generic interface for computing an autonomy posture from named signal detectors. Includes `buildTierSelector()` factory and `TierSignalDetector` / `TierSelectorFn` types. Reference implementation of the colonyOS cognitive-law pattern.

## 0.4.0 - 2026-06-10

### Breaking Changes

- **`GradedRunReportSchema`**: renamed field `failures` → `cases`. The field now accurately describes its semantics — all evaluated cases are included, with `score.passed` distinguishing outcomes. The old name implied pass-only exclusion and prevented unconditional provenance on passing runs.
- **`GradedRunFailureSchema`** renamed to **`GradedRunCaseSchema`** (same shape, corrected name).
- **`GradedRunFailure`** type renamed to **`GradedRunCase`**.
- `schemaVersion` literal `'graded-run-report.v1'` is unchanged — this rename is a pre-adoption correction; no released consumers exist.

### Migration

```ts
// Before
import { GradedRunFailureSchema, GradedRunFailure } from '@stackbilt/contracts';
const report: GradedRunReport = { ..., failures: [...] };

// After
import { GradedRunCaseSchema, GradedRunCase } from '@stackbilt/contracts';
const report: GradedRunReport = { ..., cases: [...] };
```

## 0.3.0 - 2026-05-29

### Added

- Added transport-neutral contract event runtime exports: `ContractEventSchema`, `ContractEventSink`, and `emitContractEvent()`.
- Added route-generator support for operation `emits`; generated handlers can call a caller-provided event sink after successful operations.
- Added canonical graded-run report primitives: `GradedRunReportSchema`, aggregate counts, latency summary, metric summary, score, failure, metadata, and outcome schemas.
- Added `ref()`-aware `LEFT JOIN` query shaping for generated get/list routes.
- Added generated Hono route integration-test scaffolding from `generateTests()`.

### Changed

- Benchmark report primitives now compose the canonical graded-run outcome, aggregate-count, and latency schemas.
- Generated integration tests prefer public API routes and avoid asserting DB statements for auth-only routes.
- Repeated references to the same table now use per-field SQL aliases in generated joins.

### Validation

- `npm run build`
- `npm test -- --run` - 56 tests

## 0.2.1 - 2026-05-05

### Fixed

- Removed stale package bin metadata for a non-existent `dist/cli.js`.

## 0.2.0 - 2026-05-05

### Added

- Added Entitlement and MediaAsset contract exports.
