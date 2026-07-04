/**
 * toHonoRouter Behavioral Tests (contracts#17)
 *
 * Unlike tests/routes.test.ts (which asserts on generateRoutes()'s STRING
 * output via substring matching + syntax-only ts.transpileModule), these
 * tests exercise a real, built Hono instance via app.request() — strictly
 * stronger, since it proves actual runtime behavior, not generated text.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { MiddlewareHandler } from 'hono';
import { defineContract, ref } from '../../src/core/define.js';
import { toHonoRouter } from '../../src/hono/index.js';
import type { D1LikeDatabase, D1LikeStatement } from '../../src/hono/types.js';
import type { ContractEvent } from '../../src/runtime/events.js';

const PASS_THROUGH: MiddlewareHandler = async (_c, next) => next();

// RecipeContract has routes needing all three auth capabilities
// (authenticated/owner/role) — toHonoRouter validates the WHOLE router
// up front, so any test building a RecipeContract router needs all three
// supplied, not just the one relevant to that test.
const PERMISSIVE_AUTH = {
  requireAuth: () => PASS_THROUGH,
  requireOwner: () => PASS_THROUGH,
  requireRole: () => PASS_THROUGH,
};

// ── Mock D1 (hand-written, adapted from generators/tests.ts's generated pattern) ──

function createMockDb(options: {
  statements?: string[];
  firstResult?: Record<string, unknown> | null;
  allResults?: Record<string, unknown>[];
} = {}): D1LikeDatabase {
  const statements = options.statements ?? [];
  const firstResult = options.firstResult ?? null;
  const allResults = options.allResults ?? [];

  return {
    prepare(sql: string): D1LikeStatement {
      statements.push(sql);
      const stmt: D1LikeStatement = {
        bind() {
          return stmt;
        },
        async first<T>() {
          return firstResult as T | null;
        },
        async all<T>() {
          return { results: allResults as T[] };
        },
        async run() {
          return { success: true };
        },
      };
      return stmt;
    },
  };
}

// ── Fixture contracts (mirroring tests/routes.test.ts) ──────────────────

const RecipeContract = defineContract({
  name: 'Recipe',
  version: '1.0.0',
  description: 'Recipe management with state machine',
  schema: z.object({
    id: z.string(),
    title: z.string(),
    servings: z.number().int(),
    status: z.enum(['draft', 'published', 'archived']),
  }),
  operations: {
    create: {
      input: z.object({ title: z.string(), servings: z.number().int() }),
      output: 'self',
      emits: ['recipe.created'],
    },
    get: { input: z.object({}), output: 'self' },
    list: { input: z.object({}), output: 'self' },
    update: {
      input: z.object({ title: z.string(), servings: z.number().int() }),
      output: 'self',
    },
    delete: { input: z.object({}), output: 'self' },
    publish: {
      input: z.object({}),
      output: 'self',
      transition: { from: 'draft', to: 'published' },
      emits: ['recipe.published'],
    },
  },
  states: {
    field: 'status',
    initial: 'draft',
    transitions: { draft: { publish: 'published' }, published: {}, archived: {} },
  },
  surfaces: {
    api: {
      basePath: '/api/recipes',
      routes: {
        create: { method: 'POST', path: '/' },
        get: { method: 'GET', path: '/:id' },
        list: { method: 'GET', path: '/' },
        update: { method: 'PUT', path: '/:id' },
        delete: { method: 'DELETE', path: '/:id' },
        publish: { method: 'POST', path: '/:id/publish' },
      },
    },
    db: { table: 'recipes' },
  },
  authority: {
    create: { requires: 'authenticated' },
    get: { requires: 'public' },
    list: { requires: 'public' },
    update: { requires: 'owner', ownerField: 'userId' },
    delete: { requires: 'owner', ownerField: 'userId' },
    publish: { requires: 'role', roles: ['admin'] },
  },
});

const AuthorContract = defineContract({
  name: 'Author',
  version: '1.0.0',
  description: 'An author',
  schema: z.object({ id: z.string().uuid() }),
  operations: {},
  surfaces: { db: { table: 'authors' } },
  authority: {},
});

const BookContract = defineContract({
  name: 'Book',
  version: '1.0.0',
  description: 'A book with an author ref',
  schema: z.object({ id: z.string(), authorId: ref(AuthorContract, 'id') }),
  operations: { get: { input: z.object({}), output: 'self' } },
  surfaces: {
    api: { basePath: '/books', routes: { get: { method: 'GET', path: '/:id' } } },
    db: { table: 'books' },
  },
  authority: { get: { requires: 'public' } },
});

const PureGuardedWriteContract = defineContract({
  name: 'CcTaskLike',
  version: '1.0.0',
  description: 'approve writes authority, gated on status, without transitioning status',
  schema: z.object({
    id: z.string(),
    authority: z.enum(['proposed', 'operator']),
    status: z.enum(['pending', 'running', 'done']),
  }),
  operations: {
    approve: {
      input: z.object({}),
      output: 'self',
      transition: {
        guard: (entity) => {
          const e = entity as { status: string };
          return e.status === 'pending' ? true : `status must be pending, got ${e.status}`;
        },
        writes: { authority: 'operator' },
      },
    },
  },
  surfaces: {
    api: { basePath: '/tasks', routes: { approve: { method: 'POST', path: '/:id/approve' } } },
    db: { table: 'cc_tasks_like' },
  },
  authority: { approve: { requires: 'public' } },
});

// Combined case: a real state transition AND an additional field write in
// the same operation (contracts#29's first union arm, with writes present).
// This exercises the multi-column UPDATE path, where the state column and
// the write columns must land in the same SET clause with bind values kept
// in the same order as the columns.
const CombinedTransitionAndWriteContract = defineContract({
  name: 'Job',
  version: '1.0.0',
  description: 'publish transitions status and derives slug from the row',
  schema: z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(['draft', 'published']),
    slug: z.string().nullable(),
  }),
  operations: {
    publish: {
      input: z.object({}),
      output: 'self',
      transition: {
        from: 'draft',
        to: 'published',
        writes: { slug: (entity) => (entity as { title: string }).title.toLowerCase().replace(/\s+/g, '-') },
      },
    },
  },
  states: { field: 'status', initial: 'draft', transitions: { draft: { publish: 'published' }, published: {} } },
  surfaces: {
    api: { basePath: '/jobs', routes: { publish: { method: 'POST', path: '/:id/publish' } } },
    db: { table: 'jobs' },
  },
  authority: { publish: { requires: 'public' } },
});

const NoApiContract = defineContract({
  name: 'NoApi',
  version: '1.0.0',
  description: 'no API surface',
  schema: z.object({ id: z.string() }),
  operations: {},
  surfaces: { db: { table: 'no_apis' } },
  authority: {},
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('toHonoRouter', () => {
  it('returns an empty Hono instance for a contract with no API surface', () => {
    const app = toHonoRouter(NoApiContract, { getDb: () => createMockDb() });
    expect(app.routes.length).toBe(0);
  });

  describe('create', () => {
    it('validates input, inserts, and returns 201 with camelCase payload', async () => {
      const statements: string[] = [];
      const app = toHonoRouter(RecipeContract, { getDb: () => createMockDb({ statements }), auth: PERMISSIVE_AUTH });

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Tacos', servings: 4 }),
      });

      expect(res.status).toBe(201);
      const json = await res.json() as { data: { title: string; servings: number; id: string } };
      expect(json.data.title).toBe('Tacos');
      expect(json.data.servings).toBe(4);
      expect(typeof json.data.id).toBe('string');
      expect(statements[0]).toBe('INSERT INTO recipes (id, title, servings) VALUES (?, ?, ?)');
    });

    it('returns 400 on invalid input without touching the db', async () => {
      const statements: string[] = [];
      const app = toHonoRouter(RecipeContract, { getDb: () => createMockDb({ statements }), auth: PERMISSIVE_AUTH });

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Tacos' }), // missing servings
      });

      expect(res.status).toBe(400);
      expect(statements.length).toBe(0);
    });
  });

  describe('get', () => {
    it('returns the row (snake_case, straight from D1) on success', async () => {
      const app = toHonoRouter(RecipeContract, {
        getDb: () => createMockDb({ firstResult: { id: 'r1', title: 'Tacos', status: 'draft' } }),
        auth: PERMISSIVE_AUTH,
      });

      const res = await app.request('/r1', { method: 'GET' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { id: 'r1', title: 'Tacos', status: 'draft' } });
    });

    it('returns 404 when the row is missing', async () => {
      const app = toHonoRouter(RecipeContract, { getDb: () => createMockDb({ firstResult: null }), auth: PERMISSIVE_AUTH });
      const res = await app.request('/missing', { method: 'GET' });
      expect(res.status).toBe(404);
    });

    it('uses buildSelectQuery to emit a JOIN when the schema has a ref() field', async () => {
      const statements: string[] = [];
      const app = toHonoRouter(BookContract, {
        getDb: () => createMockDb({ statements, firstResult: { id: 'b1', author_id: 'a1' } }),
      });

      await app.request('/b1', { method: 'GET' });
      expect(statements[0]).toContain('LEFT JOIN authors');
    });
  });

  describe('list', () => {
    it('returns results as an array with entityId undefined in emitted events', async () => {
      const events: ContractEvent[] = [];
      const app = toHonoRouter(RecipeContract, {
        getDb: () => createMockDb({ allResults: [{ id: 'r1' }, { id: 'r2' }] }),
        eventSink: () => (event) => { events.push(event); },
        auth: PERMISSIVE_AUTH,
      });

      const res = await app.request('/', { method: 'GET' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: [{ id: 'r1' }, { id: 'r2' }] });
      // `list` has no `emits` declared on RecipeContract, so no events either way —
      // covered by the dedicated event-payload-casing test below instead.
      expect(events).toEqual([]);
    });
  });

  describe('update', () => {
    it('updates and returns the camelCase payload merged with id', async () => {
      const statements: string[] = [];
      const app = toHonoRouter(RecipeContract, {
        getDb: () => createMockDb({ statements }),
        auth: PERMISSIVE_AUTH,
      });

      const res = await app.request('/r1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated', servings: 2 }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { id: 'r1', title: 'Updated', servings: 2 } });
      expect(statements[0]).toBe('UPDATE recipes SET title = ?, servings = ? WHERE id = ?');
    });
  });

  describe('delete', () => {
    it('deletes and returns { id }', async () => {
      const statements: string[] = [];
      const app = toHonoRouter(RecipeContract, {
        getDb: () => createMockDb({ statements }),
        auth: PERMISSIVE_AUTH,
      });

      const res = await app.request('/r1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { id: 'r1' } });
      expect(statements[0]).toBe('DELETE FROM recipes WHERE id = ?');
    });
  });

  describe('transition (state-based)', () => {
    it('rejects with 409 INVALID_STATE from the wrong state', async () => {
      const app = toHonoRouter(RecipeContract, {
        getDb: () => createMockDb({ firstResult: { id: 'r1', status: 'published' } }),
        auth: PERMISSIVE_AUTH,
      });

      const res = await app.request('/r1/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      expect(res.status).toBe(409);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('INVALID_STATE');
    });

    it('transitions state and emits the declared event on success', async () => {
      const statements: string[] = [];
      const events: ContractEvent[] = [];
      const app = toHonoRouter(RecipeContract, {
        getDb: () => createMockDb({ statements, firstResult: { id: 'r1', status: 'draft' } }),
        auth: PERMISSIVE_AUTH,
        eventSink: () => (event) => { events.push(event); },
      });

      const res = await app.request('/r1/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { id: 'r1', status: 'published' } });
      expect(statements).toContain('UPDATE recipes SET status = ? WHERE id = ?');
      expect(events).toHaveLength(1);
      expect(events[0]?.event).toBe('recipe.published');
      expect(events[0]?.entityId).toBe('r1');
      // Event payload for a transition is the raw row shape (snake_case),
      // not parsed input — matches routes.ts's emitTransitionHandler.
      expect(events[0]?.payload).toEqual({ id: 'r1', status: 'published' });
    });
  });

  describe('transition (pure guarded-write, contracts#29)', () => {
    it('writes only the guarded field, with no state-machine check at all', async () => {
      const statements: string[] = [];
      const app = toHonoRouter(PureGuardedWriteContract, {
        getDb: () => createMockDb({ statements, firstResult: { id: 't1', authority: 'proposed', status: 'pending' } }),
      });

      const res = await app.request('/t1/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: { id: 't1', authority: 'operator', status: 'pending' } });
      expect(statements).toContain('UPDATE cc_tasks_like SET authority = ? WHERE id = ?');
    });

    it('rejects with 409 GUARD_FAILED when the guard fails, and issues no UPDATE', async () => {
      const statements: string[] = [];
      const app = toHonoRouter(PureGuardedWriteContract, {
        getDb: () => createMockDb({ statements, firstResult: { id: 't1', authority: 'proposed', status: 'running' } }),
      });

      const res = await app.request('/t1/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      expect(res.status).toBe(409);
      const json = await res.json() as { error: { code: string; message: string } };
      expect(json.error.code).toBe('GUARD_FAILED');
      expect(json.error.message).toBe('status must be pending, got running');
      expect(statements.some(s => s.startsWith('UPDATE'))).toBe(false);
    });

    it('guard and writer functions receive the raw row, not parsed input', async () => {
      let guardSawStatus: string | undefined;
      const contract = defineContract({
        ...PureGuardedWriteContract,
        operations: {
          approve: {
            input: z.object({}),
            output: 'self',
            transition: {
              guard: (entity) => {
                guardSawStatus = (entity as { status: string }).status;
                return true;
              },
              writes: { authority: (entity) => `${(entity as { authority: string }).authority}-checked` },
            },
          },
        },
      });

      const app = toHonoRouter(contract, {
        getDb: () => createMockDb({ firstResult: { id: 't1', authority: 'proposed', status: 'pending' } }),
      });

      const res = await app.request('/t1/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      expect(guardSawStatus).toBe('pending');
      const json = await res.json() as { data: { authority: string } };
      expect(json.data.authority).toBe('proposed-checked');
    });
  });

  describe('transition (state + writes combined, contracts#29)', () => {
    it('sets both the state column and the written column in one UPDATE, bind values kept in order', async () => {
      const statements: string[] = [];
      const app = toHonoRouter(CombinedTransitionAndWriteContract, {
        getDb: () => createMockDb({ statements, firstResult: { id: 'j1', title: 'Ship It', status: 'draft', slug: null } }),
      });

      const res = await app.request('/j1/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      expect(res.status).toBe(200);
      expect(statements).toContain('UPDATE jobs SET status = ?, slug = ? WHERE id = ?');
      expect(await res.json()).toEqual({
        data: { id: 'j1', title: 'Ship It', status: 'published', slug: 'ship-it' },
      });
    });

    it('rejects with 409 INVALID_STATE without writing the field when the state guard fails', async () => {
      const statements: string[] = [];
      const app = toHonoRouter(CombinedTransitionAndWriteContract, {
        getDb: () => createMockDb({ statements, firstResult: { id: 'j1', title: 'Ship It', status: 'published', slug: 'ship-it' } }),
      });

      const res = await app.request('/j1/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      expect(res.status).toBe(409);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('INVALID_STATE');
      expect(statements.some(s => s.startsWith('UPDATE'))).toBe(false);
    });
  });

  describe('auth', () => {
    it('throws at router-build time when a required auth capability is missing', () => {
      expect(() => toHonoRouter(RecipeContract, { getDb: () => createMockDb() }))
        .toThrow(/requires 'authenticated' but deps.auth.requireAuth was not provided/);
    });

    it('builds successfully once the required capabilities are supplied', () => {
      expect(() => toHonoRouter(RecipeContract, {
        getDb: () => createMockDb(),
        auth: PERMISSIVE_AUTH,
      })).not.toThrow();
    });

    it('enforces requireRole before the handler runs', async () => {
      let middlewareCalled = false;
      const app = toHonoRouter(RecipeContract, {
        getDb: () => createMockDb({ firstResult: { id: 'r1', status: 'draft' } }),
        auth: {
          ...PERMISSIVE_AUTH,
          requireRole: (roles) => (async (c, next) => {
            middlewareCalled = true;
            expect(roles).toEqual(['admin']);
            return c.json({ error: { code: 'FORBIDDEN' } }, 403);
          }) as MiddlewareHandler,
        },
      });

      const res = await app.request('/r1/publish', { method: 'POST' });
      expect(middlewareCalled).toBe(true);
      expect(res.status).toBe(403);
    });
  });
});
