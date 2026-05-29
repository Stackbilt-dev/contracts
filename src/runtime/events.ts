import { z } from 'zod';

export const ContractEventSchema = z.object({
  contract: z.string().min(1),
  operation: z.string().min(1),
  event: z.string().min(1),
  entityId: z.string().min(1).optional(),
  payload: z.unknown().optional(),
  emittedAt: z.string().datetime(),
}).strict();

export type ContractEvent = z.infer<typeof ContractEventSchema>;
export type ContractEventInput = Omit<ContractEvent, 'emittedAt'> & { emittedAt?: string };
export type ContractEventSink = (event: ContractEvent) => void | Promise<void>;

/**
 * Validate and forward a contract event to an optional caller-provided sink.
 */
export async function emitContractEvent(
  sink: ContractEventSink | null | undefined,
  event: ContractEventInput,
): Promise<ContractEvent> {
  const parsed = ContractEventSchema.parse({
    ...event,
    emittedAt: event.emittedAt ?? new Date().toISOString(),
  });

  if (sink) {
    await sink(parsed);
  }

  return parsed;
}
