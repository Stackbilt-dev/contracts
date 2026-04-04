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

// Generators
export {
  generateSQL,
  generateRoutes,
  generateSDK,
  generateTests,
  generateOpenAPI,
} from './generators/index.js';

// Contracts
export { ScaffoldResponseContract } from './scaffold-response/index.js';
export type {
  ScaffoldFileType,
  FileRoleType,
  GovernanceDocsType,
  PromptContextType,
  MaterializerResultType,
} from './scaffold-response/index.js';

export { AgentResponseContract } from './agent-response/index.js';
export type {
  AgentRoleType,
  AgentDeckSlotType,
  AgentDeckRefType,
  AgentManifestType,
  AgentPositionAnalysisType,
  AgentAnalysisType,
  AgentGuidanceType,
  AgentReceiptType,
  AgentRunMetadataType,
  AgentRunResultType,
  ResponseModeType,
  ConfidenceLevelType,
} from './agent-response/index.js';
