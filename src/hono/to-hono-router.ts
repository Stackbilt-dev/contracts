/**
 * Runtime Hono Router
 *
 * toHonoRouter() returns a real, importable Hono instance instead of the
 * string codegen generateRoutes() in generators/routes.ts emits (contracts#17
 * — "cannot be type-checked by tsc, cannot be composed with typed AppEnv
 * generics"). Every handler here mirrors routes.ts's emit*Handler functions
 * behavior-for-behavior — same SQL, same casing rules, same event-payload
 * shapes — as real code instead of generated text. buildSelectQuery is
 * imported directly from routes.ts rather than re-derived, so the ref()-JOIN
 * SQL is guaranteed identical by construction.
 */

import { Hono } from 'hono';
import type { Env, Context, MiddlewareHandler } from 'hono';
import type { ContractDefinition, ContractOperation, AuthRequirement } from '../core/define.js';
import { extractColumns, toSnakeCase, toCamelCase } from '../introspect/index.js';
import { buildSelectQuery } from '../generators/routes.js';
import { emitContractEvent } from '../runtime/events.js';
import type { HonoRouterDeps, D1LikeDatabase } from './types.js';

export function toHonoRouter<E extends Env = { Bindings: { DB: D1LikeDatabase } }>(
  contract: ContractDefinition,
  deps: HonoRouterDeps<E>,
): Hono<E> {
  const app = new Hono<E>();
  const api = contract.surfaces.api;
  if (!api) return app;

  const tableName = contract.surfaces.db?.table ?? toSnakeCase(contract.name) + 's';

  for (const [routeName, routeDef] of Object.entries(api.routes)) {
    const method = routeDef.method.toLowerCase();
    const path = routeDef.path;
    const operation = contract.operations[routeName];
    const auth = contract.authority[routeName];
    const hasId = path.includes(':id');
    const isTransition = !!operation?.transition;

    const middleware = auth ? resolveAuthMiddleware<E>(auth, deps, contract.name, routeName) : undefined;

    const handler = async (c: Context<E>) => {
      try {
        if (isTransition && operation) {
          return await handleTransition(c, contract, routeName, operation, tableName, method, deps);
        }
        if (method === 'delete' && hasId) {
          return await handleDelete(c, contract, operation, routeName, tableName, deps);
        }
        if (method === 'get' && hasId) {
          return await handleGet(c, contract, operation, routeName, tableName, deps);
        }
        if (method === 'get' && !hasId) {
          return await handleList(c, contract, operation, routeName, tableName, deps);
        }
        if (method === 'post' || method === 'put' || method === 'patch') {
          if (hasId && (method === 'put' || method === 'patch')) {
            return await handleUpdate(c, contract, operation, routeName, tableName, deps);
          }
          return await handleCreate(c, contract, operation, routeName, tableName, deps);
        }
        // Fallback for unrecognized method/path patterns — matches routes.ts's codegen fallback.
        return c.json({ data: { ok: true } });
      } catch (err) {
        return c.json({ error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Unknown error' } }, 500);
      }
    };

    registerRoute(app, method, path, middleware, handler);
  }

  return app;
}

// ── Route registration ──────────────────────────────────────────────────
//
// Hono's .get/.post/.put/.patch/.delete signatures are heavily overloaded
// generics; dispatching through app[method](...) with a non-literal string
// doesn't resolve cleanly. An explicit switch avoids that entirely.

function registerRoute<E extends Env>(
  app: Hono<E>,
  method: string,
  path: string,
  middleware: MiddlewareHandler<E> | undefined,
  handler: (c: Context<E>) => Promise<Response>,
): void {
  switch (method) {
    case 'get':
      if (middleware) app.get(path, middleware, handler); else app.get(path, handler);
      return;
    case 'post':
      if (middleware) app.post(path, middleware, handler); else app.post(path, handler);
      return;
    case 'put':
      if (middleware) app.put(path, middleware, handler); else app.put(path, handler);
      return;
    case 'patch':
      if (middleware) app.patch(path, middleware, handler); else app.patch(path, handler);
      return;
    case 'delete':
      if (middleware) app.delete(path, middleware, handler); else app.delete(path, handler);
      return;
    default:
      throw new Error(`toHonoRouter: unsupported HTTP method '${method}'`);
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────

/**
 * Maps AuthRequirement -> middleware, mirroring generateAuthMiddleware() in
 * routes.ts. 'owner' resolves to requireOwner alone (routes.ts's import
 * list also collects requireAuth for owner routes, but only one middleware
 * is ever actually wired per route). Throws at router-build time (not
 * per-request) when a route needs a capability deps.auth doesn't supply —
 * fail loud at startup/CI, never silently fall back to public.
 */
function resolveAuthMiddleware<E extends Env>(
  auth: AuthRequirement,
  deps: HonoRouterDeps<E>,
  contractName: string,
  routeName: string,
): MiddlewareHandler<E> | undefined {
  switch (auth.requires) {
    case 'public':
      return undefined;
    case 'authenticated':
      if (!deps.auth?.requireAuth) {
        throw new Error(`toHonoRouter(${contractName}): route '${routeName}' requires 'authenticated' but deps.auth.requireAuth was not provided`);
      }
      return deps.auth.requireAuth();
    case 'owner':
      if (!deps.auth?.requireOwner) {
        throw new Error(`toHonoRouter(${contractName}): route '${routeName}' requires 'owner' but deps.auth.requireOwner was not provided`);
      }
      return deps.auth.requireOwner(auth.ownerField);
    case 'role':
      if (!deps.auth?.requireRole) {
        throw new Error(`toHonoRouter(${contractName}): route '${routeName}' requires 'role' but deps.auth.requireRole was not provided`);
      }
      return deps.auth.requireRole(auth.roles);
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────
// Each mirrors the matching emit*Handler in generators/routes.ts exactly,
// including its casing rules and event-payload shape (deliberately not
// uniform across handlers — see routes.ts's emitEventCalls call sites).

async function handleCreate<E extends Env>(
  c: Context<E>,
  contract: ContractDefinition,
  operation: ContractOperation | undefined,
  routeName: string,
  tableName: string,
  deps: HonoRouterDeps<E>,
): Promise<Response> {
  const body = await c.req.json();

  if (operation) {
    const parsed = operation.input.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'INVALID_INPUT', message: parsed.error.message } }, 400);
    }

    const db = deps.getDb(c);
    const id = crypto.randomUUID();
    const data = parsed.data as Record<string, unknown>;
    const cols = extractColumns(operation.input);
    const colNames = ['id', ...cols.map(col => col.name)];
    const placeholders = colNames.map(() => '?').join(', ');
    const bindValues = cols.map(col => data[toCamelCase(col.name)]);
    await db.prepare(`INSERT INTO ${tableName} (${colNames.join(', ')}) VALUES (${placeholders})`).bind(id, ...bindValues).run();

    const payload = { id, ...data };
    await emitEvents(deps, c, operation, contract.name, routeName, id, payload);
    return c.json({ data: payload }, 201);
  }

  const db = deps.getDb(c);
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO ${tableName} (id) VALUES (?)`).bind(id).run();
  const payload = { id, ...(body as Record<string, unknown>) };
  await emitEvents(deps, c, operation, contract.name, routeName, id, payload);
  return c.json({ data: payload }, 201);
}

async function handleGet<E extends Env>(
  c: Context<E>,
  contract: ContractDefinition,
  operation: ContractOperation | undefined,
  routeName: string,
  tableName: string,
  deps: HonoRouterDeps<E>,
): Promise<Response> {
  const select = buildSelectQuery(contract, tableName);
  const id = c.req.param('id');
  const db = deps.getDb(c);
  const row = await db.prepare(select.getByIdSql).bind(id).first<Record<string, unknown>>();
  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: `${contract.name} not found` } }, 404);
  await emitEvents(deps, c, operation, contract.name, routeName, id, row);
  return c.json({ data: row });
}

async function handleList<E extends Env>(
  c: Context<E>,
  contract: ContractDefinition,
  operation: ContractOperation | undefined,
  routeName: string,
  tableName: string,
  deps: HonoRouterDeps<E>,
): Promise<Response> {
  const select = buildSelectQuery(contract, tableName);
  const db = deps.getDb(c);
  const { results } = await db.prepare(select.listSql).all<Record<string, unknown>>();
  // entityId is undefined for list — matches routes.ts's emitListHandler.
  await emitEvents(deps, c, operation, contract.name, routeName, undefined, results);
  return c.json({ data: results });
}

async function handleUpdate<E extends Env>(
  c: Context<E>,
  contract: ContractDefinition,
  operation: ContractOperation | undefined,
  routeName: string,
  tableName: string,
  deps: HonoRouterDeps<E>,
): Promise<Response> {
  const id = c.req.param('id');
  const body = await c.req.json();

  if (operation) {
    const parsed = operation.input.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'INVALID_INPUT', message: parsed.error.message } }, 400);
    }

    const db = deps.getDb(c);
    const data = parsed.data as Record<string, unknown>;
    const cols = extractColumns(operation.input);
    if (cols.length > 0) {
      const setClauses = cols.map(col => `${col.name} = ?`).join(', ');
      const bindValues = cols.map(col => data[toCamelCase(col.name)]);
      await db.prepare(`UPDATE ${tableName} SET ${setClauses} WHERE id = ?`).bind(...bindValues, id).run();
    } else {
      await db.prepare(`UPDATE ${tableName} SET id = id WHERE id = ?`).bind(id).run();
    }

    const payload = { id, ...data };
    await emitEvents(deps, c, operation, contract.name, routeName, id, payload);
    return c.json({ data: payload });
  }

  // No operation defined for this route: matches routes.ts's emitUpdateHandler
  // else-branch exactly — getDb() is still called but no UPDATE is issued.
  deps.getDb(c);
  const payload = { id, ...(body as Record<string, unknown>) };
  await emitEvents(deps, c, operation, contract.name, routeName, id, payload);
  return c.json({ data: payload });
}

async function handleDelete<E extends Env>(
  c: Context<E>,
  contract: ContractDefinition,
  operation: ContractOperation | undefined,
  routeName: string,
  tableName: string,
  deps: HonoRouterDeps<E>,
): Promise<Response> {
  const id = c.req.param('id');
  const db = deps.getDb(c);
  await db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).bind(id).run();
  const payload = { id };
  await emitEvents(deps, c, operation, contract.name, routeName, id, payload);
  return c.json({ data: payload });
}

async function handleTransition<E extends Env>(
  c: Context<E>,
  contract: ContractDefinition,
  routeName: string,
  operation: ContractOperation,
  tableName: string,
  method: string,
  deps: HonoRouterDeps<E>,
): Promise<Response> {
  const transition = operation.transition!;
  const stateField = contract.states?.field ?? 'status';
  const stateCol = toSnakeCase(stateField);
  // Pure guarded-write operations (contracts#29) omit from/to entirely —
  // they don't transition states.field at all, only guard+write other
  // fields. Don't fake a same-state pseudo-transition to detect this.
  const hasStateTransition = transition.from !== undefined && transition.to !== undefined;
  const fromStates = hasStateTransition
    ? (Array.isArray(transition.from) ? transition.from : [transition.from as string])
    : [];
  const toState = transition.to;

  if (method !== 'get' && method !== 'delete') {
    const body = await c.req.json();
    const parsed = operation.input.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'INVALID_INPUT', message: parsed.error.message } }, 400);
    }
  }

  const id = c.req.param('id');
  const db = deps.getDb(c);
  const row = await db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!row) return c.json({ error: { code: 'NOT_FOUND', message: `${contract.name} not found` } }, 404);

  // State guard — only for operations that actually transition states.field
  if (hasStateTransition) {
    const currentState = row[stateCol];
    const stateOk = fromStates.length === 1
      ? currentState === fromStates[0]
      : fromStates.includes(currentState as string);
    if (!stateOk) {
      return c.json({ error: { code: 'INVALID_STATE', message: `Cannot ${routeName} from ${String(currentState)}` } }, 409);
    }
  }

  // Guard: precondition over sibling fields, checked in addition to (or, for
  // a pure guarded-write with no state transition, instead of) the state guard.
  // Guard/writer functions receive the raw persisted row (snake_case D1
  // result), never parsed input — per ContractOperation.transition's
  // documented contract in core/define.ts.
  if (transition.guard) {
    const guardResult = transition.guard(row);
    if (guardResult !== true) {
      return c.json({ error: { code: 'GUARD_FAILED', message: typeof guardResult === 'string' ? guardResult : `Guard rejected ${routeName}` } }, 409);
    }
  }

  const resolvedWrites: Record<string, unknown> = {};
  if (transition.writes) {
    for (const [key, writer] of Object.entries(transition.writes)) {
      resolvedWrites[key] = typeof writer === 'function' ? (writer as (e: unknown) => unknown)(row) : writer;
    }
  }

  const setClauses: string[] = [];
  const bindValues: unknown[] = [];
  if (hasStateTransition) {
    setClauses.push(`${stateCol} = ?`);
    bindValues.push(toState);
  }
  for (const [key, value] of Object.entries(resolvedWrites)) {
    setClauses.push(`${toSnakeCase(key)} = ?`);
    bindValues.push(value);
  }

  await db.prepare(`UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = ?`).bind(...bindValues, id).run();

  const responsePayload: Record<string, unknown> = { ...row };
  if (hasStateTransition) responsePayload[stateCol] = toState;
  for (const [key, value] of Object.entries(resolvedWrites)) {
    responsePayload[toSnakeCase(key)] = value;
  }

  await emitEvents(deps, c, operation, contract.name, routeName, id, responsePayload);
  return c.json({ data: responsePayload });
}

// ── Events ───────────────────────────────────────────────────────────────

async function emitEvents<E extends Env>(
  deps: HonoRouterDeps<E>,
  c: Context<E>,
  operation: ContractOperation | undefined,
  contractName: string,
  routeName: string,
  entityId: string | undefined,
  payload: unknown,
): Promise<void> {
  if (!operation?.emits?.length) return;
  const sink = deps.eventSink?.(c);
  for (const eventName of operation.emits) {
    await emitContractEvent(sink, {
      contract: contractName,
      operation: routeName,
      event: eventName,
      entityId,
      payload,
    });
  }
}
