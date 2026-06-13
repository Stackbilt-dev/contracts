import { z } from 'zod';

/**
 * PostureGate — named degradation signals → deterministic behavior posture.
 *
 * An unnamed primitive that appears across ≥4 Stackbilt systems
 * (colonyos cognitive-law, AEGIS circuit breakers, ARGUS heartbeat clusters,
 * dreaming confidence decay) with no shared implementation.
 *
 * Instances: colonyos `cognitive-law.ts` detectDegradationSignals/assessMode,
 * AEGIS circuit breakers + resilience stats, ARGUS heartbeat pattern clusters,
 * synthesis cycle drifting-confidence state.
 */

export const PostureSchema = z.enum(['NORMAL', 'ALT1', 'ALT2', 'DIRECT']);
export type Posture = z.infer<typeof PostureSchema>;

export const PostureSignalSchema = z.object({
  name: z.string().min(1),
  active: z.boolean(),
  value: z.number().optional(),
  detectedAt: z.string().datetime().optional(),
});
export type PostureSignal = z.infer<typeof PostureSignalSchema>;

export const PostureGateResultSchema = z.object({
  posture: PostureSchema,
  signals: z.array(PostureSignalSchema),
  activeSignalCount: z.number().int().nonnegative(),
  /** 0 = fully capability-capped, 1 = no reduction applied */
  ceilingFactor: z.number().min(0).max(1),
  evaluatedAt: z.string().datetime(),
});
export type PostureGateResult = z.infer<typeof PostureGateResultSchema>;

/** Evaluate a posture from a map of named signals. */
export function evaluatePosture(
  signals: Array<{ name: string; active: boolean; value?: number }>,
  evaluatedAt: string,
): PostureGateResult {
  const active = signals.filter(s => s.active);
  const count = active.length;

  let posture: Posture;
  let ceilingFactor: number;
  if (count === 0) {
    posture = 'NORMAL';
    ceilingFactor = 1.0;
  } else if (count === 1) {
    posture = 'ALT1';
    ceilingFactor = 0.75;
  } else if (count === 2) {
    posture = 'ALT2';
    ceilingFactor = 0.5;
  } else {
    posture = 'DIRECT';
    ceilingFactor = 0.0;
  }

  return {
    posture,
    signals: signals.map(s => ({
      name: s.name,
      active: s.active,
      ...(s.value !== undefined ? { value: s.value } : {}),
      ...(evaluatedAt ? { detectedAt: evaluatedAt } : {}),
    })),
    activeSignalCount: count,
    ceilingFactor,
    evaluatedAt,
  };
}
