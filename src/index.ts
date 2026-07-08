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
  ContractTransition,
  TransitionGuard,
  TransitionWriteValue,
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
  toCamelCase,
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
  generateMigration,
  generateRoutes,
  generateSDK,
  generateTests,
  generateOpenAPI,
  generateApiTypes,
  toApiShape,
  toDbShape,
} from './generators/index.js';

// Product-specific contracts live in their consumer repos (private).
// This package provides the framework — defineContract, generators, introspection.

export { UserContract, UserStatus, UserTier } from './contracts/user.contract.js';
export type { User, UserInput } from './contracts/user.contract.js';

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
  toAuditChainWriteOptions,
} from './contracts/attestation-envelope.js';

export type {
  AttestationEnvelope,
  AuditChainWriteOptions,
  ToAuditChainOptions,
} from './contracts/attestation-envelope.js';

export {
  CcTaskStatusSchema,
  CcTaskAuthoritySchema,
  CcTaskCategorySchema,
  CcTaskExecutorSchema,
  CcTaskSchema,
  CcTaskInputSchema,
  CcTaskContract,
  CC_TASK_COLUMNS,
} from './contracts/cc-task.contract.js';

export type {
  CcTaskStatus,
  CcTaskAuthority,
  CcTaskCategory,
  CcTaskExecutor,
  CcTask,
  CcTaskInput,
} from './contracts/cc-task.contract.js';

export {
  AUTONOMY_LADDER,
  restrictAutonomy,
  reduceAutonomy,
} from './contracts/agent-do.contract.js';

export type {
  AgentLifecycleStatus,
  AgentDOState,
  AgentDOContract,
  AutonomyLevel,
} from './contracts/agent-do.contract.js';

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

export {
  JSON_RPC_VERSION,
  MCP_PROTOCOL_VERSION,
  JSON_RPC_PARSE_ERROR,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INTERNAL_ERROR,
  MCP_SESSION_HEADER,
  JsonRpcIdSchema,
  JsonRpcErrorSchema,
  JsonRpcResponseSchema,
  McpClientInfoSchema,
  InitializeParamsSchema,
  InitializeRequestSchema,
  InitializeSessionMetadataSchema,
  InitializeResultSchema,
  ToolsListRequestSchema,
  ToolDescriptorSchema,
  ToolsListResultSchema,
  ToolsCallParamsSchema,
  ToolsCallRequestSchema,
  ToolContentBlockSchema,
  ToolsCallResultSchema,
  McpTransportRequirementsSchema,
  InternalServiceBindingAuthSchema,
  buildInternalAuthHeaders,
} from './contracts/mcp-tool-invocation.js';

export type {
  JsonRpcId,
  JsonRpcError,
  JsonRpcResponse,
  InitializeParams,
  InitializeRequest,
  InitializeResult,
  ToolsListRequest,
  ToolDescriptor,
  ToolsListResult,
  ToolsCallParams,
  ToolsCallRequest,
  ToolsCallResult,
  McpTransportRequirements,
  InternalServiceBindingAuth,
} from './contracts/mcp-tool-invocation.js';
