/**
 * AgentDO Lifecycle Contract — @stackbilt/contracts
 *
 * Closes contracts#21. Shaped by two concrete instances:
 *   MaraGovernorDO (colonyos) — continuous, alarm-driven, governance gate interior
 *   SeraAgentDO (tarotscript) — continuous, TarotScript spread interior
 *
 * This contract defines the outer skeleton only. tick() interior, inbox polling
 * cadence, and state extensions are domain-specific.
 *
 * Usage in consumers:
 *   import type { AgentDOState, AgentDOContract } from '@stackbilt/contracts';
 *   export interface MyAgentState extends AgentDOState { /* domain fields *\/ }
 *   export class MyAgentDO implements AgentDOContract { ... }
 */

// ---------------------------------------------------------------------------
// Lifecycle Status
// ---------------------------------------------------------------------------

/**
 * Agent operational status — shared state machine across all AgentDO instances.
 *
 * idle → ticking (alarm fires)
 * ticking → idle (tick completes, alarm rescheduled)
 * ticking → paused (explicit pause command)
 * paused → idle (resume command)
 * ticking → terminal (one-shot agents only, e.g. ReviewSessionDO)
 */
export type AgentLifecycleStatus = 'idle' | 'ticking' | 'paused' | 'terminal';

// ---------------------------------------------------------------------------
// Base State
// ---------------------------------------------------------------------------

/**
 * Minimal persistent state all AgentDO instances share.
 * Domain implementations extend this — never modify it directly.
 *
 * Invariants:
 *   1. current_tick MUST increment monotonically on every alarm cycle.
 *   2. An equivalent of lastObservation (domain-named) MUST be persisted
 *      before alarm() returns so the next tick starts warm.
 *   3. Sole-writer: no agent may read or write another agent's DO state.
 */
export interface AgentDOState {
  /** Monotonically increasing alarm cycle counter. */
  current_tick: number;
}

// ---------------------------------------------------------------------------
// Lifecycle Contract
// ---------------------------------------------------------------------------

/**
 * Lifecycle contract for Cloudflare Durable Object autonomous agents.
 *
 * Expected alarm() sequence (enforced by alarm scheduling, not this interface):
 *   1. Load state from DO storage
 *   2. Run domain tick (governance evaluation, spread execution, etc.)
 *   3. Poll inbox if applicable — inbox content feeds next tick's observation
 *   4. Notify AEGIS (best-effort, never blocks tick or reschedule)
 *   5. Persist updated state
 *   6. Reschedule alarm — MUST execute even if steps 2-4 threw
 *
 * Known implementations:
 *   - MaraGovernorDO (colonyos) — continuous, Colony OS governance interior
 *   - SeraAgentDO (tarotscript) — continuous, TarotScript spread interior
 *   - ReviewSessionDO (codebeast) — one-shot terminal variant
 */
export interface AgentDOContract {
  /**
   * HTTP handler. Routes MCP tool calls, SSE streams, health checks, and
   * inbox intake. Must return a valid Response for all paths — never reject
   * or throw at the DO boundary.
   */
  fetch(request: Request): Promise<Response>;

  /**
   * Alarm-driven cognitive loop.
   *
   * MUST never permanently stop: if the tick body throws, the alarm MUST
   * still be rescheduled before returning. A failed tick is recoverable;
   * a dead alarm is not.
   */
  alarm(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Autonomy Level
// ---------------------------------------------------------------------------

/**
 * Ordered autonomy levels for agent authority.
 *
 * Agents self-assess their effective autonomy ceiling each tick.
 * Cognitive degradation (MARA's control-law model) can only lower it —
 * never raise it above what the operator configured.
 *
 * manual     — no autonomous action; all decisions surfaced to operator
 * propose    — agent proposes; operator approves before execution
 * auto_low   — agent acts on low-stakes items; escalates high-stakes
 * auto_high  — agent acts on all items within its domain; escalates only
 *              on explicit override or critical cognitive degradation
 */
export type AutonomyLevel = 'manual' | 'propose' | 'auto_low' | 'auto_high';

/** Ordered autonomy levels — lower index = more restrictive. */
export const AUTONOMY_LADDER: readonly AutonomyLevel[] = ['manual', 'propose', 'auto_low', 'auto_high'];

/** Returns the more restrictive of two autonomy levels. */
export function restrictAutonomy(a: AutonomyLevel, b: AutonomyLevel): AutonomyLevel {
  return AUTONOMY_LADDER[Math.min(AUTONOMY_LADDER.indexOf(a), AUTONOMY_LADDER.indexOf(b))];
}

/** Reduces an autonomy level by N steps, clamped to 'manual'. */
export function reduceAutonomy(level: AutonomyLevel, steps: number): AutonomyLevel {
  const idx = AUTONOMY_LADDER.indexOf(level);
  return AUTONOMY_LADDER[Math.max(0, idx - steps)];
}
