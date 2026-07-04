/**
 * Route Generator Tests
 *
 * Validates that generateRoutes() emits real Hono handler bodies
 * with D1 SQL operations, state guards, try/catch, and proper
 * response envelopes — not TODO stubs.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineContract, ref } from '../src/core/define.js';
import { generateRoutes } from '../src/generators/routes.js';
import { generateTests } from '../src/generators/tests.js';

// ── Test contract ─────────────────────────────────────────────────────────

const RecipeContract = defineContract({
  name: 'Recipe',
  version: '1.0.0',
  description: 'Recipe management with state machine',
  schema: z.object({
    id: z.string(),
    title: z.string(),
    servings: z.number().int(),
    status: z.enum(['draft', 'published', 'archived']),
    createdAt: z.string(),
  }),
  operations: {
    create: {
      input: z.object({ title: z.string(), servings: z.number().int() }),
      output: 'self',
      emits: ['recipe.created'],
    },
    get: {
      input: z.object({}),
      output: 'self',
    },
    list: {
      input: z.object({}),
      output: 'self',
    },
    update: {
      input: z.object({ title: z.string(), servings: z.number().int() }),
      output: 'self',
    },
    delete: {
      input: z.object({}),
      output: 'self',
    },
    publish: {
      input: z.object({}),
      output: 'self',
      transition: { from: 'draft', to: 'published' },
      emits: ['recipe.published'],
    },
    archive: {
      input: z.object({}),
      output: 'self',
      transition: { from: ['draft', 'published'], to: 'archived' },
      emits: ['recipe.archived'],
    },
  },
  states: {
    field: 'status',
    initial: 'draft',
    transitions: {
      draft: { publish: 'published', archive: 'archived' },
      published: { archive: 'archived' },
      archived: {},
    },
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
        archive: { method: 'POST', path: '/:id/archive' },
      },
    },
    db: { table: 'recipes' },
  },
  authority: {
    create: { requires: 'authenticated' },
    get: { requires: 'public' },
    list: { requires: 'public' },
    update: { requires: 'owner', ownerField: 'user_id' },
    delete: { requires: 'owner', ownerField: 'user_id' },
    publish: { requires: 'owner', ownerField: 'user_id' },
    archive: { requires: 'role', roles: ['admin'] },
  },
});

const OrganizationContract = defineContract({
  name: 'Organization',
  version: '1.0.0',
  description: 'Organization',
  schema: z.object({ id: z.string(), name: z.string() }),
  operations: {},
  surfaces: { db: { table: 'organizations' } },
  authority: {},
});

const UserContract = defineContract({
  name: 'User',
  version: '1.0.0',
  description: 'User',
  schema: z.object({ id: z.string(), email: z.string() }),
  operations: {},
  surfaces: { db: { table: 'users' } },
  authority: {},
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('generateRoutes', () => {
  const output = generateRoutes(RecipeContract);

  it('produces output without error', () => {
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });

  it('contains NO TODO stubs', () => {
    expect(output).not.toContain('// TODO');
  });

  // ── CRUD SQL ──────────────────────────────────────────────────────────

  describe('CREATE handler', () => {
    it('emits INSERT INTO with table name', () => {
      expect(output).toContain('INSERT INTO recipes');
    });

    it('emits INSERT with input columns', () => {
      expect(output).toContain('id, title, servings');
    });

    it('emits UUID generation', () => {
      expect(output).toContain('crypto.randomUUID()');
    });

    it('returns 201 on create', () => {
      expect(output).toContain('201');
    });

    it('emits input validation for create', () => {
      expect(output).toContain('RecipeContract.operations.create.input.safeParse');
    });

    it('emits declared events only after insert succeeds', () => {
      const insertIndex = output.indexOf('INSERT INTO recipes');
      const eventIndex = output.indexOf("event: 'recipe.created'");
      const responseIndex = output.indexOf('return c.json({ data: { id, ...parsed.data } }, 201)');

      expect(output).toContain("import { emitContractEvent } from '@stackbilt/contracts'");
      expect(eventIndex).toBeGreaterThan(insertIndex);
      expect(responseIndex).toBeGreaterThan(eventIndex);
    });
  });

  describe('GET handler', () => {
    it('emits SELECT with WHERE id', () => {
      expect(output).toContain('SELECT * FROM recipes WHERE id = ?');
    });

    it('emits NOT_FOUND check', () => {
      expect(output).toContain("'NOT_FOUND'");
      expect(output).toContain('Recipe not found');
    });

    it('returns data envelope', () => {
      expect(output).toContain('return c.json({ data: row })');
    });
  });

  describe('LIST handler', () => {
    it('emits SELECT with LIMIT', () => {
      expect(output).toContain('SELECT * FROM recipes LIMIT 100');
    });

    it('returns data envelope with results', () => {
      expect(output).toContain('return c.json({ data: results })');
    });
  });

  describe('ref query generation', () => {
    it('emits LEFT JOIN clauses for ref fields on get/list routes', () => {
      const refContract = defineContract({
        name: 'OrgRecipe',
        version: '1.0.0',
        description: 'Recipe with organization ref',
        schema: z.object({
          id: z.string(),
          organizationId: ref(OrganizationContract, 'id'),
          title: z.string(),
        }),
        operations: {
          get: { input: z.object({}), output: 'self' },
          list: { input: z.object({}), output: 'self' },
        },
        surfaces: {
          api: {
            basePath: '/api/org-recipes',
            routes: {
              get: { method: 'GET', path: '/:id' },
              list: { method: 'GET', path: '/' },
            },
          },
          db: { table: 'recipes' },
        },
        authority: {
          get: { requires: 'public' },
          list: { requires: 'public' },
        },
      });

      const result = generateRoutes(refContract);

      expect(result).toContain('SELECT recipes.*, organization_id_ref.id AS organization_id_organizations_id FROM recipes LEFT JOIN organizations AS organization_id_ref ON recipes.organization_id = organization_id_ref.id WHERE recipes.id = ?');
      expect(result).toContain('SELECT recipes.*, organization_id_ref.id AS organization_id_organizations_id FROM recipes LEFT JOIN organizations AS organization_id_ref ON recipes.organization_id = organization_id_ref.id LIMIT 100');
    });

    it('aliases repeated refs to the same table', () => {
      const auditContract = defineContract({
        name: 'AuditDoc',
        version: '1.0.0',
        description: 'Document with two user refs',
        schema: z.object({
          id: z.string(),
          createdBy: ref(UserContract, 'id'),
          updatedBy: ref(UserContract, 'id'),
        }),
        operations: {
          get: { input: z.object({}), output: 'self' },
        },
        surfaces: {
          api: {
            basePath: '/api/audit-docs',
            routes: {
              get: { method: 'GET', path: '/:id' },
            },
          },
          db: { table: 'audit_docs' },
        },
        authority: {
          get: { requires: 'public' },
        },
      });

      const result = generateRoutes(auditContract);

      expect(result).toContain('LEFT JOIN users AS created_by_ref ON audit_docs.created_by = created_by_ref.id');
      expect(result).toContain('LEFT JOIN users AS updated_by_ref ON audit_docs.updated_by = updated_by_ref.id');
      expect(result).toContain('created_by_ref.id AS created_by_users_id');
      expect(result).toContain('updated_by_ref.id AS updated_by_users_id');
    });
  });

  describe('UPDATE handler', () => {
    it('emits UPDATE SET with columns', () => {
      expect(output).toContain('UPDATE recipes SET title = ?, servings = ? WHERE id = ?');
    });

    it('emits input validation for update', () => {
      expect(output).toContain('RecipeContract.operations.update.input.safeParse');
    });
  });

  describe('DELETE handler', () => {
    it('emits DELETE FROM', () => {
      expect(output).toContain('DELETE FROM recipes WHERE id = ?');
    });

    it('returns id in response', () => {
      expect(output).toContain('return c.json({ data: { id } })');
    });
  });

  // ── State transitions ─────────────────────────────────────────────────

  describe('state transition: publish (single from state)', () => {
    it('emits state guard for draft', () => {
      expect(output).toContain("row.status !== 'draft'");
    });

    it('emits INVALID_STATE error', () => {
      expect(output).toContain("'INVALID_STATE'");
      expect(output).toContain('Cannot publish from');
    });

    it('returns 409 on invalid state', () => {
      expect(output).toContain('409');
    });

    it('emits UPDATE to set new state', () => {
      expect(output).toContain("UPDATE recipes SET status = ?");
      expect(output).toContain("'published'");
    });

    it('emits transition event after state update', () => {
      const updateIndex = output.indexOf("UPDATE recipes SET status = ?");
      const eventIndex = output.indexOf("event: 'recipe.published'");

      expect(eventIndex).toBeGreaterThan(updateIndex);
    });
  });

  describe('state transition: archive (multiple from states)', () => {
    it('emits multi-state guard', () => {
      expect(output).toContain("['draft', 'published'].includes(row.status as string)");
    });

    it('emits transition to archived', () => {
      expect(output).toContain("'archived'");
    });
  });

  // ── Error handling ────────────────────────────────────────────────────

  describe('error handling', () => {
    it('wraps every handler in try/catch', () => {
      // Count try blocks — should be one per route (7 routes)
      const tryCount = (output.match(/try \{/g) || []).length;
      expect(tryCount).toBe(7);
    });

    it('emits catch with INTERNAL_ERROR', () => {
      expect(output).toContain("'INTERNAL_ERROR'");
    });

    it('emits 500 status in catch', () => {
      expect(output).toContain('500');
    });

    it('emits INVALID_INPUT for body validation', () => {
      expect(output).toContain("'INVALID_INPUT'");
    });
  });

  // ── Middleware ─────────────────────────────────────────────────────────

  describe('auth middleware', () => {
    it('includes requireAuth for create', () => {
      expect(output).toContain('requireAuth()');
    });

    it('includes requireOwner for update/delete', () => {
      expect(output).toContain("requireOwner('user_id')");
    });

    it('includes requireRole for archive', () => {
      expect(output).toContain('requireRole(["admin"])');
    });

    it('does not emit empty middleware for public routes', () => {
      expect(output).not.toContain(', ,');
    });
  });

  // ── Structure ─────────────────────────────────────────────────────────

  describe('structure', () => {
    it('imports Hono', () => {
      expect(output).toContain("import { Hono } from 'hono'");
    });

    it('imports contract', () => {
      expect(output).toContain('RecipeContract');
    });

    it('exports routes', () => {
      expect(output).toContain('export { recipeRoutes }');
    });

    it('creates typed Hono app', () => {
      expect(output).toContain('new Hono<{ Bindings: Env }>()');
    });
  });

  // ── No API surface ────────────────────────────────────────────────────

  describe('contract without API surface', () => {
    it('returns comment for no-api contract', () => {
      const noApi = defineContract({
        name: 'NoApi',
        version: '1.0.0',
        description: 'No API',
        schema: z.object({ id: z.string() }),
        operations: {},
        surfaces: { db: { table: 'no_apis' } },
        authority: {},
      });
      const result = generateRoutes(noApi);
      expect(result).toContain('no API surface defined');
    });
  });

  // ── Guarded transitions (contracts#24) ─────────────────────────────────

  describe('guarded transitions', () => {
    const CcTaskLike = defineContract({
      name: 'CcTaskLike',
      version: '1.0.0',
      description: 'A task with a guarded approval transition',
      schema: z.object({
        id: z.string(),
        authority: z.enum(['proposed', 'operator']),
        status: z.enum(['pending', 'running', 'done']),
      }),
      operations: {
        approve: {
          input: z.object({ id: z.string() }),
          output: 'self',
          transition: {
            from: 'proposed',
            to: 'operator',
            guard: (entity) => {
              const e = entity as { status: string };
              return e.status === 'pending' ? true : `status must be pending, got ${e.status}`;
            },
          },
        },
      },
      states: {
        field: 'authority',
        initial: 'proposed',
        transitions: { proposed: { approve: 'operator' }, operator: {} },
      },
      surfaces: {
        api: { basePath: '/tasks', routes: { approve: { method: 'POST', path: '/:id/approve' } } },
        db: { table: 'cc_tasks_like' },
      },
      authority: { approve: { requires: 'role', roles: ['admin'] } },
    });

    const guardedOutput = generateRoutes(CcTaskLike);

    it('emits the state guard before the field guard', () => {
      const stateIdx = guardedOutput.indexOf("row.authority !== 'proposed'");
      const guardIdx = guardedOutput.indexOf('guardResult');
      expect(stateIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeGreaterThan(stateIdx);
    });

    it('calls the operation-defined guard function against the row', () => {
      expect(guardedOutput).toContain('CcTaskLikeContract.operations.approve.transition!.guard!(row)');
    });

    it('rejects with 409 GUARD_FAILED when the guard returns a string', () => {
      expect(guardedOutput).toContain("code: 'GUARD_FAILED'");
      expect(guardedOutput).toContain('typeof guardResult === \'string\' ? guardResult');
      expect(guardedOutput).toContain('}, 409);');
    });

    it('does not emit guard code for transitions without a guard', () => {
      expect(output).not.toContain('guardResult');
    });

    it('generateTests emits a real invocation of the guard against a passing fixture', () => {
      const testsOutput = generateTests(CcTaskLike, { includeRouteIntegrationTests: false });
      expect(testsOutput).toContain("it('approve guard conforms to (entity) => true | string'");
      expect(testsOutput).toContain('CcTaskLikeContract.operations.approve.transition!.guard!');
      expect(testsOutput).toContain('expect(result).toBe(true);');
    });

    it('generateTests flags the untested rejection case with it.todo rather than a hollow assertion', () => {
      const testsOutput = generateTests(CcTaskLike, { includeRouteIntegrationTests: false });
      expect(testsOutput).toContain("it.todo('approve guard rejects transition when precondition fails");
    });

    it('generateTests emits no guard test for RecipeContract (no guards defined)', () => {
      const testsOutput = generateTests(RecipeContract, { includeRouteIntegrationTests: false });
      expect(testsOutput).not.toContain('guard conforms to');
      expect(testsOutput).not.toContain('guard rejects transition');
    });
  });

  // ── Transition writes to fields beyond states.field (contracts#29) ─────

  describe('transition writes', () => {
    // The exact motivating case: `approve` doesn't transition `status` at
    // all — it writes `authority`, gated by a guard on `status`.
    const PureGuardedWrite = defineContract({
      name: 'CcTaskLike2',
      version: '1.0.0',
      description: 'approve writes authority, gated on status, without transitioning status',
      schema: z.object({
        id: z.string(),
        authority: z.enum(['proposed', 'operator']),
        status: z.enum(['pending', 'running', 'done']),
      }),
      operations: {
        approve: {
          input: z.object({ id: z.string() }),
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
      states: { field: 'status', initial: 'pending', transitions: { pending: {}, running: {}, done: {} } },
      surfaces: {
        api: { basePath: '/tasks2', routes: { approve: { method: 'POST', path: '/:id/approve' } } },
        db: { table: 'cc_tasks_like_2' },
      },
      authority: { approve: { requires: 'role', roles: ['admin'] } },
    });

    const pureWriteOutput = generateRoutes(PureGuardedWrite);

    it('emits no state-guard check when the operation has no from/to', () => {
      expect(pureWriteOutput).not.toContain('INVALID_STATE');
    });

    it('still emits the field guard', () => {
      expect(pureWriteOutput).toContain('CcTaskLike2Contract.operations.approve.transition!.guard!(row)');
      expect(pureWriteOutput).toContain("code: 'GUARD_FAILED'");
    });

    it('resolves the write value (literal) and applies it in the UPDATE', () => {
      expect(pureWriteOutput).toContain("const authorityWriter = CcTaskLike2Contract.operations.approve.transition!.writes!['authority'];");
      expect(pureWriteOutput).toContain('UPDATE cc_tasks_like_2 SET authority = ? WHERE id = ?');
      expect(pureWriteOutput).toContain('.bind(authorityValue, id)');
    });

    it('reflects the written field in the response payload', () => {
      expect(pureWriteOutput).toContain('{ ...row, authority: authorityValue }');
    });

    // Combined case: a real state transition AND an additional field write
    // in the same operation. The write function can only compute from the
    // row itself (per its documented contract) — here, deriving a slug from
    // the row's own title at publish time, not from request/actor data.
    const CombinedTransitionAndWrite = defineContract({
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
          input: z.object({ id: z.string() }),
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

    const combinedOutput = generateRoutes(CombinedTransitionAndWrite);

    it('emits both the state guard and the write for a combined transition', () => {
      expect(combinedOutput).toContain("row.status !== 'draft'");
      expect(combinedOutput).toContain("const slugWriter = JobContract.operations.publish.transition!.writes!['slug'];");
    });

    it('sets both the state column and the written column in one UPDATE, in order', () => {
      expect(combinedOutput).toContain('UPDATE jobs SET status = ?, slug = ? WHERE id = ?');
      expect(combinedOutput).toContain(".bind('published', slugValue, id)");
    });

    it('resolves a function-valued write by calling it with the row', () => {
      expect(combinedOutput).toContain('typeof slugWriter === \'function\' ? (slugWriter as (e: unknown) => unknown)(row) : slugWriter');
    });
  });

  // ── Table name fallback ───────────────────────────────────────────────

  describe('table name fallback', () => {
    it('derives table name from contract name when db surface has no table', () => {
      const minimal = defineContract({
        name: 'Task',
        version: '1.0.0',
        description: 'Task',
        schema: z.object({ id: z.string(), name: z.string() }),
        operations: {
          list: { input: z.object({}), output: 'self' },
        },
        surfaces: {
          api: {
            basePath: '/api/tasks',
            routes: { list: { method: 'GET', path: '/' } },
          },
        },
        authority: { list: { requires: 'public' } },
      });
      const result = generateRoutes(minimal);
      expect(result).toContain('SELECT * FROM tasks LIMIT 100');
    });
  });
});
