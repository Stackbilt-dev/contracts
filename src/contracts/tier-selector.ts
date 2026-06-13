import { evaluatePosture } from './posture-gate.js';
import type { PostureGateResult } from './posture-gate.js';

/**
 * TierSelector — the generic interface for computing an autonomy posture from named signals.
 *
 * Named pattern: the same object built independently in colonyOS (cognitive-law.ts),
 * AEGIS taskrunner (authority enum), and Charter (TierDefinition drafts).
 *
 * Reference implementation: colonyOS `detectDegradationSignals` + `assessMode`.
 * This interface provides the canonical shape; each system implements its own
 * signal detectors and plugs them into `buildTierSelector()`.
 *
 * Usage:
 *   const selectPosture = buildTierSelector([
 *     { name: 'circuit_open', detect: () => checkCircuitBreaker() },
 *     { name: 'task_failure_burst', detect: () => checkRecentFailures() },
 *   ])
 *   const result = await selectPosture()
 *   // result.posture: NORMAL | ALT1 | ALT2 | DIRECT
 *   // result.ceilingFactor: 0–1 (apply to max allowed autonomy level)
 */

export interface TierSignalDetector {
  name: string;
  detect: () => Promise<{ active: boolean; value?: number }>;
}

export type TierSelectorFn = () => Promise<PostureGateResult>;

/**
 * Build a TierSelector from an array of named signal detectors.
 * Each detector is called concurrently; failures default to inactive (fail-safe).
 */
export function buildTierSelector(
  detectors: TierSignalDetector[],
): TierSelectorFn {
  return async () => {
    const evaluatedAt = new Date().toISOString();
    const signals = await Promise.all(
      detectors.map(async (d) => {
        const result = await d.detect().catch((): { active: boolean; value?: number } => ({ active: false }));
        return { name: d.name, active: result.active, ...(result.value !== undefined ? { value: result.value } : {}) };
      }),
    );
    return evaluatePosture(signals, evaluatedAt);
  };
}

export type { PostureGateResult };
