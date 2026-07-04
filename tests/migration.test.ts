import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineContract } from '../src/core/define.js';
import { generateMigration, generateSQL } from '../src/generators/sql.js';
import { UserContract } from '../src/contracts/user.contract.js';
import { toCamelCase } from '../src/introspect/zod-walker.js';
import { generateApiTypes } from '../src/generators/api-types.js';

const PantryItemContract = defineContract({
  name: 'PantryItem',
  version: '1.0.0',
  description: 'A pantry item with expiry tracking',
  schema: z.object({
    id: z.string().uuid(),
    userId: z.string(),
    name: z.string(),
    quantity: z.number().default(1),
    unit: z.string().optional(),
    expiryDate: z.string().datetime().optional(),
    notes: z.string().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
  operations: {
    create: {
      input: z.object({ userId: z.string(), name: z.string(), quantity: z.number().optional() }),
      output: 'self' as const,
    },
    update: {
      input: z.object({ id: z.string(), name: z.string().optional(), quantity: z.number().optional() }),
      output: 'self' as const,
    },
  },
  surfaces: {
    db: {
      table: 'pantry_items',
      columnOverrides: {
        createdAt: { default: 'CURRENT_TIMESTAMP' },
        updatedAt: { default: 'CURRENT_TIMESTAMP' },
      },
    },
  },
  authority: {
    create: { requires: 'authenticated' },
    update: { requires: 'owner', ownerField: 'userId' },
  },
});

describe('generateMigration', () => {
  it('emits ALTER TABLE for columns not in existingColumns', () => {
    const sql = generateMigration(PantryItemContract, {
      existingColumns: ['id', 'user_id', 'name', 'created_at', 'updated_at'],
    });

    expect(sql).toContain('ALTER TABLE pantry_items ADD COLUMN quantity');
    expect(sql).toContain('ALTER TABLE pantry_items ADD COLUMN expiry_date');
    expect(sql).toContain('ALTER TABLE pantry_items ADD COLUMN notes');
    expect(sql).toContain('ALTER TABLE pantry_items ADD COLUMN unit');
  });

  it('does not emit ALTER TABLE ADD COLUMN for existing columns', () => {
    const sql = generateMigration(PantryItemContract, {
      existingColumns: ['id', 'user_id', 'name', 'quantity', 'unit', 'expiry_date', 'notes', 'created_at', 'updated_at'],
    });

    expect(sql).not.toContain('ADD COLUMN');
    expect(sql).toContain('No new columns detected');
  });

  it('notes removed columns (prod-only) as comments', () => {
    const sql = generateMigration(PantryItemContract, {
      existingColumns: ['id', 'user_id', 'name', 'category', 'created_at', 'updated_at'],
    });

    expect(sql).toContain('category');
    expect(sql).toContain('D1 cannot DROP COLUMN');
  });

  it('respects tableName override', () => {
    const sql = generateMigration(PantryItemContract, {
      existingColumns: ['id'],
      tableName: 'food_items',
    });

    expect(sql).toContain('ALTER TABLE food_items');
  });

  it('adds DEFAULT for NOT NULL columns to satisfy D1 ADD COLUMN constraint', () => {
    const sql = generateMigration(PantryItemContract, {
      existingColumns: ['id', 'user_id', 'name', 'unit', 'expiry_date', 'notes', 'created_at', 'updated_at'],
    });

    // quantity has a default of 1, so should be NOT NULL DEFAULT 1
    expect(sql).toMatch(/ADD COLUMN quantity.*DEFAULT 1/);
  });
});

describe('generateSQL columnOverrides', () => {
  it('applies columnOverrides declared with camelCase keys (contracts#25)', () => {
    const sql = generateSQL(PantryItemContract);

    expect(sql).toContain('created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
    expect(sql).toContain('updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
  });

  it('applies columnOverrides declared with snake_case keys too', () => {
    const contract = defineContract({
      ...PantryItemContract,
      surfaces: {
        db: {
          table: 'pantry_items',
          columnOverrides: {
            created_at: { default: 'CURRENT_TIMESTAMP' },
          },
        },
      },
    });

    const sql = generateSQL(contract);
    expect(sql).toContain('created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
  });

  it('applies camelCase columnOverrides in generateMigration ADD COLUMN output too', () => {
    const sql = generateMigration(PantryItemContract, {
      existingColumns: ['id', 'user_id', 'name', 'quantity', 'unit', 'expiry_date', 'notes'],
    });

    expect(sql).toMatch(/ADD COLUMN created_at.*DEFAULT CURRENT_TIMESTAMP/);
    expect(sql).toMatch(/ADD COLUMN updated_at.*DEFAULT CURRENT_TIMESTAMP/);
  });
});

describe('generateSQL boolean defaults (contracts#26)', () => {
  it('emits 0/1 for boolean column defaults instead of true/false', () => {
    const contract = defineContract({
      name: 'Job',
      version: '1.0.0',
      description: 'A job with a retryable flag',
      schema: z.object({
        id: z.string().uuid(),
        retryable: z.boolean().default(false),
        urgent: z.boolean().default(true),
      }),
      operations: {},
      surfaces: { db: { table: 'jobs' } },
      authority: {},
    });

    const sql = generateSQL(contract);

    expect(sql).toContain('retryable INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('urgent INTEGER NOT NULL DEFAULT 1');
    expect(sql).not.toContain('DEFAULT false');
    expect(sql).not.toContain('DEFAULT true');
  });
});

describe('UserContract', () => {
  it('generates valid CREATE TABLE SQL', () => {
    const sql = generateSQL(UserContract);

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(sql).toContain('id TEXT PRIMARY KEY');
    expect(sql).toContain('email TEXT');
    expect(sql).toContain('UNIQUE');
    expect(sql).toContain("CHECK (status IN ('active', 'suspended', 'deleted'))");
    expect(sql).toContain("CHECK (tier IN ('free', 'hobby', 'pro'))");
  });

  it('has expected operations', () => {
    expect(Object.keys(UserContract.operations)).toEqual(
      expect.arrayContaining(['create', 'update', 'suspend', 'reactivate', 'delete']),
    );
  });

  it('state machine covers all transitions', () => {
    expect(UserContract.states?.transitions.active.suspend).toBe('suspended');
    expect(UserContract.states?.transitions.suspended.reactivate).toBe('active');
    expect(UserContract.states?.transitions.active.delete).toBe('deleted');
  });
});

describe('toCamelCase', () => {
  it('converts snake_case to camelCase', () => {
    expect(toCamelCase('expiry_date')).toBe('expiryDate');
    expect(toCamelCase('user_id')).toBe('userId');
    expect(toCamelCase('created_at')).toBe('createdAt');
    expect(toCamelCase('id')).toBe('id');
  });
});

describe('generateApiTypes', () => {
  it('emits a TypeScript interface for the entity', () => {
    const output = generateApiTypes(UserContract);

    expect(output).toContain('export interface User {');
    expect(output).toContain('id: string;');
    expect(output).toContain('email: string;');
    // status and tier have Zod defaults so they are optional in the entity type
    expect(output).toContain('status?:');
    expect(output).toContain("'active' | 'suspended' | 'deleted'");
  });

  it('emits operation input types', () => {
    const output = generateApiTypes(UserContract);

    expect(output).toContain('export interface UserCreateInput');
    expect(output).toContain('export interface UserUpdateInput');
    expect(output).toContain('export type UserCreateOutput = User;');
  });

  it('emits route constants', () => {
    const output = generateApiTypes(UserContract);

    expect(output).toContain('USER_ROUTES');
    expect(output).toContain("basePath: '/api/users'");
    expect(output).toContain("method: 'POST'");
  });
});
