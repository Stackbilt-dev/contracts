import { describe, expect, it } from 'vitest';
import {
  AttestationEnvelopeSchema,
  canonicalPayload,
  toAuditChainWriteOptions,
} from '../src/index.js';

const envelope = {
  envelopeId: '123e4567-e89b-12d3-a456-426614174000',
  traceId: 'trace-abc',
  tenantId: 'tenant-1',
  ticketRef: 'github:Stackbilt-dev/aegis#42',
  agentId: 'agent-7',
  model: 'claude-sonnet-5',
  provider: 'anthropic',
  inputTokens: 100,
  outputTokens: 50,
  costUsd: 0.01,
  result: { ok: true },
  sealedAt: '2026-07-08T00:00:00.000Z',
};

describe('AttestationEnvelope', () => {
  it('validates a canonical envelope shape', () => {
    const result = AttestationEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it('produces a deterministic canonical payload', () => {
    const payload = canonicalPayload(envelope);
    expect(JSON.parse(payload)).toEqual({
      envelopeId: envelope.envelopeId,
      traceId: envelope.traceId,
      tenantId: envelope.tenantId,
      ticketRef: envelope.ticketRef,
      agentId: envelope.agentId,
      model: envelope.model,
      provider: envelope.provider,
      costUsd: envelope.costUsd,
      sealedAt: envelope.sealedAt,
    });
  });

  describe('toAuditChainWriteOptions', () => {
    it('derives audit-chain identity fields from the envelope by default', () => {
      const opts = toAuditChainWriteOptions(envelope);

      expect(opts.namespace).toBe(`tenant:${envelope.tenantId}`);
      expect(opts.event_type).toBe('attestation.sealed');
      expect(opts.actor).toBe(envelope.agentId);
    });

    it('falls back to a system actor when agentId is absent', () => {
      const { agentId: _agentId, ...withoutAgent } = envelope;
      const opts = toAuditChainWriteOptions(withoutAgent);

      expect(opts.actor).toBe('system');
    });

    it('lets the caller override namespace, event_type, and actor', () => {
      const opts = toAuditChainWriteOptions(envelope, {
        namespace: 'content:draft-9',
        eventType: 'evidence.validation.completed',
        actor: 'system:evidence-engine',
      });

      expect(opts.namespace).toBe('content:draft-9');
      expect(opts.event_type).toBe('evidence.validation.completed');
      expect(opts.actor).toBe('system:evidence-engine');
    });

    it('carries the full envelope as the record payload without mutation', () => {
      const opts = toAuditChainWriteOptions(envelope);

      expect(opts.payload).toEqual(envelope);
      expect(opts.payload).not.toBe(envelope);
    });

    it('produces a payload that round-trips back through the envelope schema', () => {
      const opts = toAuditChainWriteOptions(envelope);
      const reparsed = AttestationEnvelopeSchema.safeParse(opts.payload);

      expect(reparsed.success).toBe(true);
    });

    it('matches the shape of audit-chain writeRecord() options (minus bindings + chainHead)', () => {
      const opts = toAuditChainWriteOptions(envelope);

      expect(Object.keys(opts).sort()).toEqual(
        ['actor', 'event_type', 'namespace', 'payload'].sort(),
      );
    });
  });
});
