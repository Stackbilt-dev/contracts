/**
 * @stackbilt/contracts — Contract Ontology Layer
 *
 * Stackbilt's pragmatic realization of Ontology-Driven Design (ODD).
 * TypeScript + Zod instead of RDF/OWL/SHACL. Same goals:
 * centralized knowledge, grounded reasoning, zero inference.
 *
 * Define contracts. Generate everything.
 */

// Core primitives
export {
  defineContract,
  ref,
  extend,
} from './core/index.js';

export type {
  ContractDefinition,
  ContractOperation,
  ContractStates,
  ContractSurface,
  ApiSurface,
  DbSurface,
  ContractInvariant,
  AuthRequirement,
} from './core/index.js';

// Introspection
export {
  extractColumns,
  extractEnums,
  toSnakeCase,
} from './introspect/index.js';

export type { ColumnDef } from './introspect/index.js';

// Runtime helpers
export {
  ContractEventSchema,
  emitContractEvent,
} from './runtime/events.js';

export type {
  ContractEvent,
  ContractEventInput,
  ContractEventSink,
} from './runtime/events.js';

// Generators
export {
  generateSQL,
  generateRoutes,
  generateSDK,
  generateTests,
  generateOpenAPI,
} from './generators/index.js';

// Product-specific contracts live in their consumer repos (private).
// This package provides the framework — defineContract, generators, introspection.

export { EntitlementContract } from './contracts/entitlement.contract.js';
export { MediaAssetContract } from './contracts/media-asset.contract.js';
export {
  GradedRunAggregateCountsSchema,
  GradedRunCaseSchema,
  GradedRunLatencySummarySchema,
  GradedRunMetadataSchema,
  GradedRunMetricSummarySchema,
  GradedRunOutcomeSchema,
  GradedRunReportSchema,
  GradedRunScoreSchema,
} from './contracts/graded-run.js';

export type {
  GradedRunAggregateCounts,
  GradedRunCase,
  GradedRunLatencySummary,
  GradedRunMetadata,
  GradedRunMetricSummary,
  GradedRunOutcome,
  GradedRunReport,
  GradedRunScore,
} from './contracts/graded-run.js';

export {
  ActTypeSchema,
  ActStatusSchema,
  CognitiveActInputSchema,
  CognitiveActRecordSchema,
  EmittedActSchema,
  CognitiveActContract,
} from './contracts/cognitive-act.js';

export type {
  ActType,
  ActStatus,
  CognitiveActInput,
  CognitiveActRecord,
  EmittedAct,
} from './contracts/cognitive-act.js';

export {
  buildTierSelector,
} from './contracts/tier-selector.js';

export type { TierSignalDetector, TierSelectorFn } from './contracts/tier-selector.js';

export {
  PostureSchema,
  PostureSignalSchema,
  PostureGateResultSchema,
  evaluatePosture,
} from './contracts/posture-gate.js';

export type { Posture, PostureSignal, PostureGateResult } from './contracts/posture-gate.js';

export {
  AttestationEnvelopeSchema,
  canonicalPayload,
} from './contracts/attestation-envelope.js';

export type { AttestationEnvelope } from './contracts/attestation-envelope.js';

export {
  BenchmarkAggregateCountsSchema,
  BenchmarkArtifactDigestSchema,
  BenchmarkCostSummarySchema,
  BenchmarkInferenceCallSummarySchema,
  BenchmarkLatencySummarySchema,
  BenchmarkOutcomeSchema,
  BenchmarkReportSchema,
  BenchmarkRunMetadataSchema,
  PublicBenchmarkSummarySchema,
} from './contracts/benchmark-report.js';

export type {
  BenchmarkAggregateCounts,
  BenchmarkArtifactDigest,
  BenchmarkCostSummary,
  BenchmarkInferenceCallSummary,
  BenchmarkLatencySummary,
  BenchmarkOutcome,
  BenchmarkReport,
  BenchmarkRunMetadata,
  PublicBenchmarkSummary,
} from './contracts/benchmark-report.js';
