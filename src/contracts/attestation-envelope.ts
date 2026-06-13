import { z } from 'zod';

/**
 * AttestationEnvelope — result + provenance binding sealed for later verification.
 *
 * An unnamed primitive appearing across ≥4 Stackbilt systems with no shared
 * sealing layer. The wire-frozen name 'GraderRun' in evals is evidence it's
 * already a de facto format without a spec.
 *
 * Instances: stackd (HMAC-SHA256 receipts bound to ticket/model/cost),
 * audit-chain (tamper-evident hash chains), reading-envelope contract
 * (trace_id + tenant_id binding to prevent cross-tenant inference),
 * evals GraderRun receipts.
 *
 * Goal: let audit-chain become the canonical sealing layer under stackd
 * receipts and dispatch traces (Stackproof product primitive).
 */

export const AttestationEnvelopeSchema = z.object({
  envelopeId: z.string().uuid(),
  /** Distributed trace identifier — links to the originating request chain. */
  traceId: z.string().min(1),
  /** Tenant or org context — prevents cross-tenant inference collisions. */
  tenantId: z.string().min(1),
  /** Originating work item, e.g. 'github:org/repo#123' or 'cc_task:uuid'. */
  ticketRef: z.string().optional(),
  agentId: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  /** The sealed payload — opaque at this layer. */
  result: z.unknown(),
  sealedAt: z.string().datetime(),
  /** HMAC-SHA256 hex over canonical fields, if locally signed (e.g. by stackd). */
  hmac: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
export type AttestationEnvelope = z.infer<typeof AttestationEnvelopeSchema>;

/** Fields included in the HMAC-SHA256 canonical payload (deterministic ordering). */
export function canonicalPayload(e: AttestationEnvelope): string {
  return JSON.stringify({
    envelopeId: e.envelopeId,
    traceId: e.traceId,
    tenantId: e.tenantId,
    ticketRef: e.ticketRef ?? null,
    agentId: e.agentId ?? null,
    model: e.model ?? null,
    provider: e.provider ?? null,
    costUsd: e.costUsd ?? null,
    sealedAt: e.sealedAt,
  });
}
