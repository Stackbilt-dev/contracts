import type { Env, Context, MiddlewareHandler } from 'hono';
import type { ContractEventSink } from '../runtime/events.js';

/**
 * Minimal structural D1 surface this package actually uses. Not
 * `@cloudflare/workers-types`' `D1Database` — this package has zero
 * Cloudflare-type dependencies, and a real D1Database/D1PreparedStatement
 * satisfies this narrower shape via duck typing (extra methods on the real
 * types don't break assignability into a narrower expected parameter type).
 */
export interface D1LikeStatement {
  bind(...args: unknown[]): D1LikeStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

export interface D1LikeDatabase {
  prepare(sql: string): D1LikeStatement;
}

/**
 * Dependency injection for toHonoRouter(). The string-codegen generateRoutes()
 * hardcodes `c.env.DB` and an `import { requireAuth, ... } from
 * '../middleware/auth'` that only exists in the consumer's own repo — a real
 * runtime router can't hardcode either, so both are supplied by the caller.
 */
export interface HonoRouterDeps<E extends Env = { Bindings: { DB: D1LikeDatabase } }> {
  /** Resolve the D1-like database from the Hono context. No default — there's no safe guess for the binding name. */
  getDb: (c: Context<E>) => D1LikeDatabase;
  /**
   * Auth middleware factories, mirroring generateAuthMiddleware()'s mapping
   * of AuthRequirement -> middleware in routes.ts. If a route's
   * contract.authority entry needs a capability this object doesn't supply,
   * toHonoRouter() throws at router-build time (fail loud at startup/CI,
   * never silently fall back to public).
   */
  auth?: {
    requireAuth?: () => MiddlewareHandler<E>;
    requireOwner?: (ownerField: string) => MiddlewareHandler<E>;
    requireRole?: (roles: string[]) => MiddlewareHandler<E>;
  };
  /** Resolve the event sink for emitContractEvent(), when an operation declares `emits`. */
  eventSink?: (c: Context<E>) => ContractEventSink | undefined;
}
