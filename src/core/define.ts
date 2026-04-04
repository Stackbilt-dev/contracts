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

export interface ContractOperation<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType | 'self' = z.ZodType | 'self',
> {
  /** Input schema for this operation */
  input: TInput;
  /** Output schema — 'self' means returns the entity itself */
  output: TOutput;
  /** State transition triggered by this operation */
  transition?: { from: string | string[]; to: string };
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
 */
export function ref<T extends ContractDefinition>(
  contract: T,
  field: string,
): z.ZodString & { __ref: { contract: T; field: string } } {
  const schema = z.string() as z.ZodString & { __ref: { contract: T; field: string } };
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
