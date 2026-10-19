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
const session = (quota: unknown) => ({ tier: 'free', scopes: [], ttlSeconds: 60, quota });
const parses = (quota: unknown) => InitializeSessionMetadataSchema.safeParse(session(quota)).success;

describe('InitializeSessionMetadataSchema quota', () => {
  it('parses the { scaffolds, note } shape from stackbilt-mcp-gateway#100 and keeps its values', () => {
    const parsed = InitializeResultSchema.parse(result({ scaffolds: 3, note: '3 scaffolds units/mo by default.' }));
    expect(parsed.serverInfo.metadata?.session?.quota).toEqual({ scaffolds: 3, note: '3 scaffolds units/mo by default.' });
  });

  it('parses the legacy { credits, note } shape and keeps credits', () => {
    const parsed = InitializeResultSchema.parse(result({ credits: 25, note: '25 credits/mo.' }));
    expect(parsed.serverInfo.metadata?.session?.quota).toEqual({ credits: 25, note: '25 credits/mo.' });
  });

  it('accepts -1 as the unlimited sentinel', () => {
    expect(parses({ scaffolds: -1, note: 'Unlimited.' })).toBe(true);
  });

  it('rejects a quota with neither count', () => {
    expect(parses({ note: 'x' })).toBe(false);
  });

  it('rejects a missing note', () => {
    expect(parses({ scaffolds: 3 })).toBe(false);
  });

  it('rejects a non-numeric count', () => {
    expect(parses({ scaffolds: '3', note: 'x' })).toBe(false);
  });

  it('rejects non-integer counts', () => {
    expect(parses({ scaffolds: 2.5, note: 'x' })).toBe(false);
  });

  it('rejects counts below the -1 sentinel', () => {
    expect(parses({ credits: -7, note: 'x' })).toBe(false);
  });

  it('quota stays optional', () => {
    expect(InitializeSessionMetadataSchema.safeParse({ tier: 'free', scopes: [], ttlSeconds: 60 }).success).toBe(true);
  });
});
