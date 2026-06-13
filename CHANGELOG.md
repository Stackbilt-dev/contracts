# Changelog

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
