import { describe, expect, it } from 'vitest';
import { InitializeResultSchema, InitializeSessionMetadataSchema } from '../src/contracts/mcp-tool-invocation.js';

const result = (quota: unknown) => ({
  protocolVersion: '2025-03-26',
  capabilities: { tools: { listChanged: false } },
  serverInfo: {
    name: 'stackbilt-mcp-gateway',
    version: '0.2.2',
    metadata: { session: { tier: 'free', scopes: ['generate', 'read'], ttlSeconds: 3600, quota } },
  },
});

describe('InitializeSessionMetadataSchema quota', () => {
  it('accepts the gateway hint shape { scaffolds, note } (stackbilt-mcp-gateway#99)', () => {
    const parsed = InitializeResultSchema.parse(result({ scaffolds: 3, note: '3 scaffolds units/mo by default.' }));
    expect(parsed.serverInfo.metadata?.session?.quota).toEqual({ scaffolds: 3, note: '3 scaffolds units/mo by default.' });
  });

  it('accepts unlimited (-1) scaffolds', () => {
    expect(InitializeResultSchema.safeParse(result({ scaffolds: -1, note: 'Unlimited.' })).success).toBe(true);
  });

  it('still accepts the legacy { credits, note } shape', () => {
    expect(InitializeResultSchema.safeParse(result({ credits: 25, note: '25 credits/mo.' })).success).toBe(true);
  });

  it('still requires note, and rejects non-numeric counts', () => {
    const session = { tier: 'free', scopes: [], ttlSeconds: 60 };
    expect(InitializeSessionMetadataSchema.safeParse({ ...session, quota: { scaffolds: 3 } }).success).toBe(false);
    expect(InitializeSessionMetadataSchema.safeParse({ ...session, quota: { scaffolds: '3', note: 'x' } }).success).toBe(false);
  });

  it('quota stays optional', () => {
    expect(InitializeSessionMetadataSchema.safeParse({ tier: 'free', scopes: [], ttlSeconds: 60 }).success).toBe(true);
  });
});
