/**
 * Agent Response Contract
 *
 * Defines the response shape for TarotScript's agent-cast spread.
 * This is the canonical schema for POST /agents/run responses consumed by
 * stackbilt-web, the MCP gateway, and downstream consumers.
 *
 * An agent = 4 decks (persona, domain, governance, actions). The agent-cast
 * spread draws one card from each, plus a synthesized confidence position.
 * All LLM routing goes through the oracle providers layer.
 */

import { z } from 'zod';
import { defineContract } from '../core/index.js';

// ── Schema Version ──────────────────────────────────────────────────────

export const SchemaVersion = z.literal(1);

// ── Agent Enums ─────────────────────────────────────────────────────────

export const AgentRole = z.enum(['cto', 'ciso', 'cfo', 'cmo', 'cpo', 'architect']);

export const AgentCoreSlot = z.enum(['persona', 'domain', 'governance', 'actions']);

export const AgentDeckSlot = z.enum(['persona', 'domain', 'governance', 'actions', 'memory']);

export const ResponseMode = z.enum(['symbolic', 'natural', 'structured-only']);

export const ConfidenceLevel = z.enum(['high', 'medium', 'low']);

export const Orientation = z.enum(['upright', 'reversed']);

// ── Agent Deck Ref ──────────────────────────────────────────────────────

export const AgentDeckRef = z.object({
  slot: AgentDeckSlot,
  path: z.string(),
  name: z.string(),
});

// ── Agent Manifest ──────────────────────────────────────────────────────

export const AgentManifest = z.object({
  manifestVersion: z.literal(1),
  identity: z.object({
    role: AgentRole,
    name: z.string(),
    description: z.string(),
    version: z.string(),
    generatedAt: z.string(),
  }),
  decks: z.object({
    persona: AgentDeckRef,
    domain: AgentDeckRef,
    governance: AgentDeckRef,
    actions: AgentDeckRef,
    memory: AgentDeckRef.optional(),
  }),
  tags: z.array(z.string()),
});

// ── Position Analysis ───────────────────────────────────────────────────

export const AgentPositionAnalysis = z.object({
  position: z.string(),
  cardName: z.string(),
  element: z.string(),
  orientation: Orientation,
  deckSlot: z.union([AgentDeckSlot, z.literal('domain')]),
  properties: z.record(z.string(), z.string()),
});

// ── Structured Analysis ─────────────────────────────────────────────────

export const AgentAnalysis = z.object({
  stance: z.string(),
  domainLens: z.string(),
  constraint: z.string(),
  recommendedAction: z.string(),
  confidence: ConfidenceLevel,
  confidenceScore: z.number().min(0).max(1),
  positions: z.array(AgentPositionAnalysis),
});

// ── Agent Guidance ──────────────────────────────────────────────────────

export const AgentGuidance = z.object({
  recommendation: z.string(),
  constraints: z.string(),
  risks: z.string(),
});

// ── Receipt ─────────────────────────────────────────────────────────────

export const AgentReceipt = z.object({
  hash: z.string(),
  seed: z.number(),
  timestamp: z.string(),
});

// ── Run Metadata ────────────────────────────────────────────────────────

export const AgentRunMetadata = z.object({
  latencyMs: z.number(),
  manifestVersion: z.number(),
  decksLoaded: z.array(AgentDeckSlot),
});

// ── Bootstrap Methodology ──────────────────────────────────────────────
// The "deck research" workflow — how the bootstrap pipeline chose cards.
// This is the "agents are decks, not prompts" thesis in structured form.

export const BootstrapMethodology = z.object({
  /** What kind of signal was detected in the domain */
  signalType: z.string(),
  signalClass: z.string(),
  /** What gap in existing decks this agent would fill */
  gapType: z.string(),
  gapClass: z.string(),
  /** Research approach for card curation */
  researchStrategy: z.string(),
  researchType: z.string(),
  /** Evidence bar for card inclusion */
  evidenceBar: z.string(),
  tierAssignment: z.string(),
  /** How confident the bootstrap is in its methodology (0.0–1.0) */
  methodologyConfidence: z.number().min(0).max(1),
});

export const BootstrapResult = z.object({
  schema_version: SchemaVersion,
  success: z.boolean(),
  role: AgentRole,
  domain: z.string(),
  response: z.string(),
  symbolicResponse: z.string(),
  /** Structured research methodology — the deck curation pipeline's reasoning */
  methodology: BootstrapMethodology,
  receipt: AgentReceipt,
  responseMode: ResponseMode,
  metadata: z.object({
    latencyMs: z.number(),
  }),
});

// ── Cognitive Metrics ──────────────────────────────────────────────────
// Shannon diversity + depletion tracking for agent memory health.

export const CognitiveMetrics = z.object({
  shannonDiversity: z.number(),
  elementCounts: z.record(z.string(), z.number()),
  depletionRatio: z.number(),
  transCapacity: z.number(),
  totalCards: z.number(),
});

// ── Memory Zone Counts ─────────────────────────────────────────────────

export const MemoryZoneCounts = z.object({
  discard: z.number(),
  deck: z.number(),
  metaInsight: z.number(),
  identity: z.number(),
});

// ── Memory Card Summary ────────────────────────────────────────────────

export const MemoryCardSummary = z.object({
  name: z.string(),
  element: z.string(),
  tier: z.string(),
  zone: z.string(),
  accessCount: z.number(),
  outcome: z.string(),
  context: z.string(),
});

// ── Inscribe Result ────────────────────────────────────────────────────

export const InscribeResult = z.object({
  success: z.boolean(),
  role: AgentRole,
  zone: z.string(),
  totalCards: z.number(),
  entropy: CognitiveMetrics,
});

// ── Memory Query Result ────────────────────────────────────────────────

export const MemoryQueryResult = z.object({
  role: AgentRole,
  exists: z.boolean(),
  tick: z.number().optional(),
  zones: MemoryZoneCounts,
  entropy: CognitiveMetrics,
  recentMemories: z.array(MemoryCardSummary).optional(),
  updatedAt: z.string().optional(),
});

// ── Telemetry Result ───────────────────────────────────────────────────

export const AgentTelemetry = z.object({
  count: z.number(),
  metrics: z.object({
    confidence_distribution: z.record(z.string(), z.number()),
    top_cards: z.array(z.object({ name: z.string(), count: z.number() })),
    action_type_distribution: z.record(z.string(), z.number()),
    avg_latency_ms: z.number(),
    stance_constraint_tension_rate: z.string(),
    domain_action_tension_rate: z.string(),
  }),
  recent: z.array(z.record(z.string(), z.unknown())),
});

// ── Run Result (top-level agent response) ───────────────────────────────

export const AgentRunResult = z.object({
  schema_version: SchemaVersion,
  success: z.boolean(),
  role: AgentRole,
  response: z.string(),
  symbolicResponse: z.string(),
  analysis: AgentAnalysis,
  guidance: AgentGuidance.optional(),
  receipt: AgentReceipt,
  responseMode: ResponseMode,
  metadata: AgentRunMetadata,
});

// ── Contract Definition ─────────────────────────────────────────────────

export const AgentResponseContract = defineContract({
  name: 'AgentResponse',
  version: '2.0.0',
  description: 'Full agent platform contract — consultation, bootstrap, memory lifecycle, and telemetry. Agents are decks: transparent, calibratable, receipt-auditable.',

  schema: AgentRunResult,

  operations: {
    run: {
      input: z.object({
        role: AgentRole.optional(),
        intention: z.string(),
        context: z.record(z.string(), z.string()).optional(),
        painSignals: z.array(z.string()).optional(),
        responseMode: ResponseMode.optional(),
        seed: z.number().optional(),
        inscribe: z.boolean().optional(),
        lenient: z.boolean().optional(),
      }),
      output: 'self' as const,
    },

    bootstrap: {
      input: z.object({
        role: AgentRole.optional(),
        domain: z.string().optional(),
        internalSignals: z.array(z.string()).optional(),
        intention: z.string().optional(),
        responseMode: ResponseMode.optional(),
        seed: z.number().optional(),
      }),
      output: BootstrapResult,
    },

    inscribe: {
      input: z.object({
        content: z.string(),
        context: z.string().optional(),
        outcome: z.string().optional(),
        source_action: z.string().optional(),
        confidence: ConfidenceLevel.optional(),
        element: z.string().optional(),
        inscription_mode: z.enum(['normal', 'flash']).optional(),
        failure_count: z.number().optional(),
        tags: z.string().optional(),
      }),
      output: InscribeResult,
    },

    memory: {
      input: z.object({}),
      output: MemoryQueryResult,
    },

    telemetry: {
      input: z.object({}),
      output: AgentTelemetry,
    },
  },

  surfaces: {
    api: {
      basePath: '/agents',
      routes: {
        run: { method: 'POST', path: '/run' },
        bootstrap: { method: 'POST', path: '/bootstrap' },
        inscribe: { method: 'POST', path: '/:role/inscribe' },
        memory: { method: 'GET', path: '/:role/memory' },
        telemetry: { method: 'GET', path: '/telemetry' },
      },
    },
  },

  authority: {
    run: { requires: 'authenticated' },
    bootstrap: { requires: 'authenticated' },
    inscribe: { requires: 'authenticated' },
    memory: { requires: 'authenticated' },
    telemetry: { requires: 'authenticated' },
  },
});

// ── Inferred Types (for import by worker and consumers) ─────────────────

export type AgentRole = z.infer<typeof AgentRole>;
export type AgentCoreSlot = z.infer<typeof AgentCoreSlot>;
export type AgentDeckSlot = z.infer<typeof AgentDeckSlot>;
export type AgentDeckRef = z.infer<typeof AgentDeckRef>;
export type AgentManifest = z.infer<typeof AgentManifest>;
export type AgentPositionAnalysis = z.infer<typeof AgentPositionAnalysis>;
export type AgentAnalysis = z.infer<typeof AgentAnalysis>;
export type AgentGuidance = z.infer<typeof AgentGuidance>;
export type AgentReceipt = z.infer<typeof AgentReceipt>;
export type AgentRunMetadata = z.infer<typeof AgentRunMetadata>;
export type AgentRunResult = z.infer<typeof AgentRunResult>;
export type BootstrapMethodology = z.infer<typeof BootstrapMethodology>;
export type BootstrapResult = z.infer<typeof BootstrapResult>;
export type CognitiveMetrics = z.infer<typeof CognitiveMetrics>;
export type MemoryZoneCounts = z.infer<typeof MemoryZoneCounts>;
export type MemoryCardSummary = z.infer<typeof MemoryCardSummary>;
export type InscribeResult = z.infer<typeof InscribeResult>;
export type MemoryQueryResult = z.infer<typeof MemoryQueryResult>;
export type AgentTelemetry = z.infer<typeof AgentTelemetry>;
export type ResponseMode = z.infer<typeof ResponseMode>;
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;
export type Orientation = z.infer<typeof Orientation>;
export type SchemaVersion = z.infer<typeof SchemaVersion>;
