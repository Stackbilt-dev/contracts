import { describe, expect, it } from 'vitest';
import { ContractEventSchema, emitContractEvent, type ContractEvent } from '../src/index.js';

describe('contract event runtime', () => {
  it('validates and forwards events to a caller-provided sink', async () => {
    const events: ContractEvent[] = [];

    const emitted = await emitContractEvent(
      event => events.push(event),
      {
        contract: 'Recipe',
        operation: 'publish',
        event: 'recipe.published',
        entityId: 'recipe-001',
        payload: { id: 'recipe-001', status: 'published' },
      },
    );

    expect(events).toEqual([emitted]);
    expect(ContractEventSchema.safeParse(emitted).success).toBe(true);
    expect(emitted.emittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('validates events even when no sink is configured', async () => {
    const emitted = await emitContractEvent(undefined, {
      contract: 'Recipe',
      operation: 'create',
      event: 'recipe.created',
    });

    expect(emitted.event).toBe('recipe.created');
  });

  it('rejects malformed events before they reach the sink', async () => {
    const events: ContractEvent[] = [];

    await expect(emitContractEvent(
      event => events.push(event),
      {
        contract: '',
        operation: 'create',
        event: 'recipe.created',
      },
    )).rejects.toThrow();

    expect(events).toEqual([]);
  });
});
