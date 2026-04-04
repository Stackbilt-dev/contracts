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

export const AgentDeckSlot = z.enum(['persona', 'domain', 'governance', 'actions']);

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
  properties: z.record(z.string()),
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
  version: '1.0.0',
  description: 'Response contract for TarotScript agent-cast readings — C-Level agent reasoning with structured analysis, confidence scoring, and dignity tensions.',

  schema: AgentRunResult,

  operations: {
    run: {
      input: z.object({
        role: AgentRole.optional(),
        intention: z.string(),
        context: z.record(z.string()).optional(),
        painSignals: z.array(z.string()).optional(),
        responseMode: ResponseMode.optional(),
        seed: z.number().optional(),
      }),
      output: 'self' as const,
    },
  },

  surfaces: {
    api: {
      basePath: '/agents',
      routes: {
        run: { method: 'POST', path: '/run' },
      },
    },
  },

  authority: {
    run: { requires: 'authenticated' },
  },
});

// ── Inferred Types (for import by worker and consumers) ─────────────────

export type AgentRole = z.infer<typeof AgentRole>;
export type AgentDeckSlot = z.infer<typeof AgentDeckSlot>;
export type AgentDeckRef = z.infer<typeof AgentDeckRef>;
export type AgentManifest = z.infer<typeof AgentManifest>;
export type AgentPositionAnalysis = z.infer<typeof AgentPositionAnalysis>;
export type AgentAnalysis = z.infer<typeof AgentAnalysis>;
export type AgentGuidance = z.infer<typeof AgentGuidance>;
export type AgentReceipt = z.infer<typeof AgentReceipt>;
export type AgentRunMetadata = z.infer<typeof AgentRunMetadata>;
export type AgentRunResult = z.infer<typeof AgentRunResult>;
export type ResponseMode = z.infer<typeof ResponseMode>;
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;
export type Orientation = z.infer<typeof Orientation>;
export type SchemaVersion = z.infer<typeof SchemaVersion>;
