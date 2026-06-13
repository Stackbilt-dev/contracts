import { z } from 'zod';
import { defineContract } from '../core/index.js';

/**
 * CognitiveAct — the canonical act record for the AEGIS Total Provenance Ledger.
 *
 * Every autonomous AEGIS act (chat dispatch, dreaming synthesis, self-improvement,
 * goal execution, content generation, memory consolidation) is sealed as a
 * CognitiveAct. The sealed payload is stored in the `cognitive_acts` D1 table
 * and separately in R2 via @stackbilt/audit-chain (tamper-evident hash chain).
 *
 * Relationship to AttestationEnvelope:
 *   AttestationEnvelope is the provenance binding layer (who, what, how much).
 *   CognitiveAct is the domain-specific act layer — adds type, rationale, status,
 *   and the chain linking fields (prev_hash, chain_hash, receipt_ref).
 *
 * Honesty constraint: metric_score MUST be a grounded outcome (merged PR,
 * agent_actions.outcome row). Never pass an LLM opinion — a tamper-evident
 * receipt around a fabricated score is the exact failure mode this ledger prevents.
 */

export const ActTypeSchema = z.enum([
  'chat_dispatch',
  'dreaming_synthesis',
  'self_improvement_pr',
  'goal_execution',
  'content_generation',
  'memory_consolidation',
  'cc_task_completion',
]);
export type ActType = z.infer<typeof ActTypeSchema>;

export const ActStatusSchema = z.enum(['sealed', 'scored']);
export type ActStatus = z.infer<typeof ActStatusSchema>;

/** Input shape — what callers pass to emitAct(). */
export const CognitiveActInputSchema = z.object({
  act_type: ActTypeSchema,
  actor: z.string().min(1).max(200),
  rationale: z.string().min(1),
  classification: z.string().max(100).nullable().optional(),
  cost_usd: z.number().nonnegative().nullable().optional(),
  latency_ms: z.number().int().nonnegative().nullable().optional(),
  /** Pointer, never payload — keeps the ledger from becoming a content mirror. */
  input_ref: z.string().nullable().optional(),
  output_ref: z.string().nullable().optional(),
  /** Grounded score in [0,1] from a real downstream outcome. Null = honestly unscored. */
  metric_score: z.number().min(0).max(1).nullable().optional(),
  /** ScorerResult JSON backing the score — serialized before storage. */
  metric_detail: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Real occurrence time. Defaults to now() for live self-emit. Projected/backfilled
   *  acts MUST pass the original event time. */
  occurred_at: z.string().datetime().nullable().optional(),
});
export type CognitiveActInput = z.infer<typeof CognitiveActInputSchema>;

/** Full record shape — what lives in D1 after emitAct(). */
export const CognitiveActRecordSchema = z.object({
  id: z.string().uuid(),
  act_type: ActTypeSchema,
  actor: z.string().min(1),
  status: ActStatusSchema,
  ts: z.string().datetime(),
  metric_score: z.number().min(0).max(1).nullable(),
  metric_detail: z.string().nullable(),
  rationale: z.string().min(1),
  classification: z.string().nullable(),
  cost_usd: z.number().nonnegative().nullable(),
  latency_ms: z.number().int().nonnegative().nullable(),
  input_ref: z.string().nullable(),
  output_ref: z.string().nullable(),
  prev_hash: z.string().min(1),
  chain_hash: z.string().min(1),
  receipt_ref: z.string().min(1),
});
export type CognitiveActRecord = z.infer<typeof CognitiveActRecordSchema>;

export const EmittedActSchema = z.object({
  id: z.string().uuid(),
  chain_hash: z.string().min(1),
  receipt_ref: z.string().min(1),
});
export type EmittedAct = z.infer<typeof EmittedActSchema>;

/** ODD contract — use generateSQL() to produce the D1 migration. */
export const CognitiveActContract = defineContract({
  name: 'CognitiveAct',
  version: '1.0.0',
  description: 'Tamper-evident record of every autonomous AEGIS act, sealed via audit-chain',

  schema: z.object({
    id: z.string().uuid(),
    act_type: ActTypeSchema,
    actor: z.string().min(1).max(200),
    status: ActStatusSchema.default('sealed'),
    ts: z.string().datetime(),
    metric_score: z.number().min(0).max(1).nullable(),
    metric_detail: z.string().nullable(),
    rationale: z.string().min(1),
    classification: z.string().max(100).nullable(),
    cost_usd: z.number().nonnegative().nullable(),
    latency_ms: z.number().int().nonnegative().nullable(),
    input_ref: z.string().nullable(),
    output_ref: z.string().nullable(),
    prev_hash: z.string().min(1),
    chain_hash: z.string().min(1),
    receipt_ref: z.string().min(1),
  }),

  operations: {
    seal: {
      input: CognitiveActInputSchema,
      output: 'self' as const,
      transition: { from: [], to: 'sealed' },
      emits: ['cognitive_act.sealed'],
    },
    score: {
      input: z.object({
        id: z.string().uuid(),
        metric_score: z.number().min(0).max(1),
        metric_detail: z.record(z.string(), z.unknown()).optional(),
      }),
      output: 'self' as const,
      transition: { from: ['sealed'], to: 'scored' },
      emits: ['cognitive_act.scored'],
    },
  },

  states: {
    field: 'status',
    initial: 'sealed',
    transitions: {
      sealed: { score: 'scored' },
      scored: {},
    },
  },

  surfaces: {
    db: {
      table: 'cognitive_acts',
      indexes: [
        'idx_cognitive_acts_type_ts(act_type, ts)',
        'idx_cognitive_acts_actor(actor)',
        'idx_cognitive_acts_chain(chain_hash)',
      ],
      columnOverrides: {
        ts: { default: 'CURRENT_TIMESTAMP' },
      },
    },
  },

  authority: {
    seal: { requires: 'role', roles: ['system'] },
    score: { requires: 'role', roles: ['system'] },
  },

  invariants: [
    {
      name: 'scored_requires_metric_score',
      description: 'A scored act must have a non-null metric_score',
      check: (entity: unknown) => {
        const e = entity as { status?: string; metric_score?: number | null };
        if (e.status === 'scored' && (e.metric_score === null || e.metric_score === undefined)) {
          return 'Scored act requires metric_score';
        }
        return true;
      },
      appliesTo: ['score'],
    },
  ],
});
