# Changelog

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
