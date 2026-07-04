/**
 * Contract definition primitives.
 *
 * The Contract Ontology Layer — Stackbilt's pragmatic realization of
 * Ontology-Driven Design (ODD). TypeScript + Zod instead of RDF/OWL/SHACL.
 *
 * A contract declares:
 *   schema      — entity shape (Zod)
 *   operations  — valid actions with typed I/O
 *   states      — state machine transitions
 *   surfaces    — API route + DB table mapping
 *   authority   — role-based access rules
 *   invariants  — runtime business rules
 *   version     — semver for the contract
 */

import { z } from 'zod';

// ── Operation ────────────────────────────────────────────────────────────

/**
 * A literal value, or a function of the persisted row, for an additional
 * field write. Structurally this is just `unknown` — TypeScript can't
 * discriminate a bare function type from `unknown` in a union — the
 * function arm exists to document intent; generateRoutes()'s
 * `typeof x === 'function'` check at codegen time is what actually
 * distinguishes them.
 */
export type TransitionWriteValue = unknown | ((entity: unknown) => unknown);

/**
 * Precondition over sibling fields. Same signature as ContractInvariant.check
 * — return `true` to allow, or a violation message to reject.
 *
 * generateRoutes() calls this against the raw persisted row (D1 result shape
 * — snake_case columns), not the camelCase entity shape the schema infers.
 * A guard reading `entity.retryCount` will see `undefined`; read
 * `entity.retry_count` instead.
 */
export type TransitionGuard = (entity: unknown) => true | string;

export type ContractTransition =
  | {
      /** States.field values this operation is valid from. */
      from: string | string[];
      /** States.field value this operation transitions to. */
      to: string;
      guard?: TransitionGuard;
      /**
       * Additional field writes beyond states.field, applied in the same
       * UPDATE. For "this operation also changes field X" alongside the
       * state transition.
       *
       * A function value is called with the same raw persisted row (D1
       * result shape — snake_case columns) that `guard` receives — not
       * request input, not auth context, not the camelCase entity shape.
       * It can only compute from what's already on the row (e.g. derive one
       * column from another); it cannot see the incoming request body or
       * the caller's identity.
       */
      writes?: Record<string, TransitionWriteValue>;
    }
  | {
      // No states.field involvement at all — see the writes-only variant below.
      from?: undefined;
      to?: undefined;
      guard?: TransitionGuard;
      /**
       * Pure guarded field-write: the operation doesn't transition
       * states.field (may not even change it), it writes these fields,
       * gated by `guard`. For "operation availability/effect conditional on
       * a field value" that isn't itself a state-machine transition — e.g.
       * `cc_tasks.approve` changes `authority`, not `status`, gated by
       * `status === 'pending'` — see contracts#29. Don't fake this with a
       * same-state `from`/`to` pseudo-transition; it silently implies a
       * status write that isn't happening.
       */
      writes: Record<string, TransitionWriteValue>;
    };

export interface ContractOperation<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType | 'self' = z.ZodType | 'self',
> {
  /** Input schema for this operation */
  input: TInput;
  /** Output schema — 'self' means returns the entity itself */
  output: TOutput;
  /** State transition and/or guarded field-write triggered by this operation */
  transition?: ContractTransition;
  /** Events emitted on success */
  emits?: string[];
}

// ── State Machine ────────────────────────────────────────────────────────

export interface ContractStates {
  /** Schema field that holds state */
  field: string;
  /** Initial state for new entities */
  initial: string;
  /** Map of state → { operation → target_state }. null = terminal (delete). */
  transitions: Record<string, Record<string, string | null>>;
}

// ── Surfaces ─────────────────────────────────────────────────────────────

export interface ApiSurface {
  basePath: string;
  routes: Record<string, { method: string; path: string }>;
}

export interface DbSurface {
  table: string;
  indexes?: string[];
  /** Columns with UNIQUE constraints */
  uniqueColumns?: string[];
  /** Per-column SQL-expression defaults (e.g. strftime, CURRENT_TIMESTAMP) */
  columnOverrides?: Record<string, { default?: string }>;
}

export interface ContractSurface {
  api?: ApiSurface;
  db?: DbSurface;
}

// ── Authority ────────────────────────────────────────────────────────────

export type AuthRequirement =
  | { requires: 'public' }
  | { requires: 'authenticated' }
  | { requires: 'owner'; ownerField: string }
  | { requires: 'role'; roles: string[] };

// ── Invariants ───────────────────────────────────────────────────────────

export interface ContractInvariant {
  name: string;
  description: string;
  check: (entity: unknown) => true | string;
  appliesTo: string[];
}

// ── Contract Definition ──────────────────────────────────────────────────

export interface ContractDefinition<
  TSchema extends z.ZodType = z.ZodType,
> {
  name: string;
  version: string;
  description: string;
  schema: TSchema;
  operations: Record<string, ContractOperation>;
  states?: ContractStates;
  surfaces: ContractSurface;
  authority: Record<string, AuthRequirement>;
  invariants?: ContractInvariant[];
}

// ── Factory ──────────────────────────────────────────────────────────────

/**
 * Define a domain contract. Pure declaration — no side effects.
 */
export function defineContract<TSchema extends z.ZodType>(
  definition: ContractDefinition<TSchema>,
): ContractDefinition<TSchema> {
  return definition;
}

/**
 * Cross-contract reference. Declares a typed foreign key.
 * Generators use the ref metadata to produce JOIN clauses and
 * referential integrity constraints.
 *
 * Accepts a thunk (`() => Contract`) for self-referential FKs, where the
 * target contract is the one currently being constructed and doesn't exist
 * yet at the point `ref()` is called inside its own `defineContract()` call
 * — e.g. `ref(() => GenerationJob, 'id')` inside `GenerationJob`'s own
 * schema. The thunk is only invoked by generators after the whole module
 * has finished evaluating, by which point the binding is initialized.
 */
export function ref<T extends ContractDefinition>(
  contract: T | (() => T),
  field: string,
): z.ZodString & { __ref: { contract: T | (() => T); field: string } } {
  const schema = z.string() as z.ZodString & { __ref: { contract: T | (() => T); field: string } };
  schema.__ref = { contract, field };
  return schema;
}

/**
 * Contract inheritance. Extends a base contract with additional fields,
 * operations, or state transitions. Base contract remains untouched.
 */
export function extend<TBase extends z.ZodType, TExtended extends z.ZodType>(
  base: ContractDefinition<TBase>,
  extension: {
    name: string;
    version?: string;
    description?: string;
    schema?: (base: TBase) => TExtended;
    operations?: Record<string, ContractOperation>;
    states?: (base: Record<string, Record<string, string | null>>) => Record<string, Record<string, string | null>>;
    surfaces?: Partial<ContractSurface>;
    authority?: Record<string, AuthRequirement>;
    invariants?: ContractInvariant[];
  },
): ContractDefinition<TExtended> {
  return {
    name: extension.name,
    version: extension.version ?? base.version,
    description: extension.description ?? base.description,
    schema: extension.schema
      ? extension.schema(base.schema)
      : (base.schema as unknown as TExtended),
    operations: { ...base.operations, ...extension.operations },
    states: base.states
      ? {
          ...base.states,
          transitions: extension.states
            ? extension.states(base.states.transitions)
            : base.states.transitions,
        }
      : undefined,
    surfaces: {
      api: extension.surfaces?.api ?? base.surfaces.api,
      db: extension.surfaces?.db ?? base.surfaces.db,
    },
    authority: { ...base.authority, ...extension.authority },
    invariants: [...(base.invariants ?? []), ...(extension.invariants ?? [])],
  };
}
