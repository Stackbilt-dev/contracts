/**
 * Recipe Contract — example contract demonstrating the ODD pattern.
 *
 * This shows how to define a contract with schema, operations, state machine,
 * surfaces (API + DB), authority, and invariants. Use this as a template
 * for your own domain contracts.
 */

import { z } from 'zod';
import { defineContract } from '../core/index.js';

// ── Enums ────────────────────────────────────────────────────────────────

export const RecipeStatus = z.enum(['draft', 'published', 'archived']);
export type RecipeStatus = z.infer<typeof RecipeStatus>;

export const Difficulty = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof Difficulty>;

// ── Contract ─────────────────────────────────────────────────────────────

export const RecipeContract = defineContract({
  name: 'Recipe',
  version: '1.0.0',
  description: 'A cooking recipe with lifecycle management',

  schema: z.object({
    id: z.string().uuid(),
    userId: z.string(),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    ingredients: z.array(z.string()),
    instructions: z.string(),
    servings: z.number().int().positive(),
    prepTimeMinutes: z.number().int().nonnegative(),
    cookTimeMinutes: z.number().int().nonnegative(),
    difficulty: Difficulty,
    tags: z.array(z.string()),
    status: RecipeStatus.default('draft'),
    publishedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),

  operations: {
    create: {
      input: z.object({
        userId: z.string(),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        ingredients: z.array(z.string()),
        instructions: z.string(),
        servings: z.number().int().positive(),
        prepTimeMinutes: z.number().int().nonnegative(),
        cookTimeMinutes: z.number().int().nonnegative(),
        difficulty: Difficulty,
        tags: z.array(z.string()).optional(),
      }),
      output: 'self' as const,
      emits: ['recipe.created'],
    },

    update: {
      input: z.object({
        id: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        ingredients: z.array(z.string()).optional(),
        instructions: z.string().optional(),
        servings: z.number().int().positive().optional(),
        difficulty: Difficulty.optional(),
        tags: z.array(z.string()).optional(),
      }),
      output: 'self' as const,
      emits: ['recipe.updated'],
    },

    publish: {
      input: z.object({ id: z.string().uuid() }),
      output: 'self' as const,
      transition: { from: 'draft', to: 'published' },
      emits: ['recipe.published'],
    },

    archive: {
      input: z.object({ id: z.string().uuid() }),
      output: 'self' as const,
      transition: { from: ['draft', 'published'], to: 'archived' },
      emits: ['recipe.archived'],
    },

    delete: {
      input: z.object({ id: z.string().uuid() }),
      output: z.object({ deleted: z.boolean() }),
    },
  },

  states: {
    field: 'status',
    initial: 'draft',
    transitions: {
      draft:     { publish: 'published', archive: 'archived', delete: null },
      published: { archive: 'archived' },
      archived:  {},
    },
  },

  surfaces: {
    api: {
      basePath: '/api/recipes',
      routes: {
        create:  { method: 'POST',   path: '/' },
        list:    { method: 'GET',    path: '/' },
        get:     { method: 'GET',    path: '/:id' },
        update:  { method: 'PUT',    path: '/:id' },
        publish: { method: 'POST',   path: '/:id/publish' },
        archive: { method: 'POST',   path: '/:id/archive' },
        delete:  { method: 'DELETE', path: '/:id' },
      },
    },
    db: {
      table: 'recipes',
      indexes: [
        'idx_recipe_user(user_id, status)',
        'idx_recipe_status(status, published_at)',
      ],
      columnOverrides: {
        createdAt: { default: 'CURRENT_TIMESTAMP' },
        updatedAt: { default: 'CURRENT_TIMESTAMP' },
      },
    },
  },

  authority: {
    create:  { requires: 'authenticated' },
    list:    { requires: 'public' },
    get:     { requires: 'public' },
    update:  { requires: 'owner', ownerField: 'userId' },
    publish: { requires: 'owner', ownerField: 'userId' },
    archive: { requires: 'owner', ownerField: 'userId' },
    delete:  { requires: 'owner', ownerField: 'userId' },
  },

  invariants: [
    {
      name: 'requires_ingredients',
      description: 'Published recipes must have at least one ingredient',
      check: (entity: unknown) => {
        const e = entity as { status: string; ingredients: string[] };
        if (e.status === 'published' && (!e.ingredients || e.ingredients.length === 0)) {
          return 'Published recipes must have at least one ingredient';
        }
        return true;
      },
      appliesTo: ['publish'],
    },
  ],
});
