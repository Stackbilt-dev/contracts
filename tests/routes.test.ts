/**
 * Route Generator Tests
 *
 * Validates that generateRoutes() emits real Hono handler bodies
 * with D1 SQL operations, state guards, try/catch, and proper
 * response envelopes — not TODO stubs.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineContract } from '../src/core/define.js';
import { generateRoutes } from '../src/generators/routes.js';

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
    },
    archive: {
      input: z.object({}),
      output: 'self',
      transition: { from: ['draft', 'published'], to: 'archived' },
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
