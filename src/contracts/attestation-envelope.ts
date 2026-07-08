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
 * This schema is the sealed-payload shape, not audit-chain's own
 * `AuditRecord` shape — the two are different layers (see
 * `toAuditChainWriteOptions()` below for the bridge). As of 2026-07,
 * no consumer has adopted this yet; each of the four instances above
 * still has its own bespoke sealing logic.
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

/**
 * `@stackbilt/audit-chain`'s `writeRecord()` options, minus the `bindings`
 * and `chainHead` arguments a caller supplies separately. Duplicated here
 * (not imported) to keep this package dependency-free — see
 * `@stackbilt/audit-chain`'s `AuditRecord` / `writeRecord()` for the source
 * of truth on this shape.
 */
export interface AuditChainWriteOptions {
  namespace: string;
  event_type: string;
  actor: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ToAuditChainOptions {
  /** audit-chain namespace for this envelope's chain. Defaults to `tenant:{tenantId}`. */
  namespace?: string;
  /** audit-chain event_type. Defaults to `'attestation.sealed'`. */
  eventType?: string;
  /** audit-chain actor. Defaults to `envelope.agentId`, falling back to `'system'`. */
  actor?: string;
}

/**
 * Bridge an `AttestationEnvelope` into `@stackbilt/audit-chain`'s
 * `writeRecord()` options.
 *
 * `AttestationEnvelope` and audit-chain's `AuditRecord` are different
 * layers, not the same shape: the envelope is the sealed unit of work
 * (result + provenance — traceId, tenantId, model, cost, hmac), while
 * `AuditRecord` is the generic hash-chained log entry that wraps *any*
 * event. This function makes the envelope the record's `payload` and
 * derives sensible defaults for the chain-identity fields (`namespace`,
 * `actor`) that the envelope has no equivalent for — it does not attempt
 * to unify the two field vocabularies into one flat schema.
 */
export function toAuditChainWriteOptions(
  envelope: AttestationEnvelope,
  options: ToAuditChainOptions = {},
): AuditChainWriteOptions {
  return {
    namespace: options.namespace ?? `tenant:${envelope.tenantId}`,
    event_type: options.eventType ?? 'attestation.sealed',
    actor: options.actor ?? envelope.agentId ?? 'system',
    payload: { ...envelope },
  };
}
