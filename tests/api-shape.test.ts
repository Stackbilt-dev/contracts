import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineContract, ref } from '../src/core/define.js';
import { toApiShape, toDbShape } from '../src/generators/api-shape.js';

const AuthorContract = defineContract({
  name: 'Author',
  version: '1.0.0',
  description: 'An author',
  schema: z.object({ id: z.string().uuid() }),
  operations: {},
  surfaces: { db: { table: 'authors' } },
  authority: {},
});

// Deliberately authored in snake_case, matching FoodFiles' real convention
// (contracts#20's motivating case) — as opposed to this repo's own examples,
// which tend to use camelCase schema keys already.
const SnakeCaseContract = defineContract({
  name: 'PantryItem',
  version: '1.0.0',
  description: 'A pantry item with expiry tracking',
  schema: z.object({
    id: z.string().uuid(),
    user_id: ref(AuthorContract, 'id'),
    expiry_date: z.string().datetime().optional(),
    quantity: z.number().default(1),
  }),
  operations: {},
  surfaces: { db: { table: 'pantry_items' } },
  authority: {},
});

// Already camelCase, matching this repo's own contract convention — must be
// a safe no-op (toCamelCase/toSnakeCase are idempotent round-trips here).
const CamelCaseContract = defineContract({
  name: 'Recipe',
  version: '1.0.0',
  description: 'A recipe',
  schema: z.object({
    id: z.string().uuid(),
    userId: ref(AuthorContract, 'id'),
    createdAt: z.string().datetime(),
  }),
  operations: {},
  surfaces: { db: { table: 'recipes' } },
  authority: {},
});

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_2 = '22222222-2222-4222-8222-222222222222';

describe('toApiShape (contracts#20)', () => {
  it('camelCases snake_case-authored schema keys', () => {
    const apiShape = toApiShape(SnakeCaseContract);
    expect(Object.keys(apiShape.shape)).toEqual(['id', 'userId', 'expiryDate', 'quantity']);
  });

  it('camelCases nested ref() fields', () => {
    const apiShape = toApiShape(SnakeCaseContract);
    expect('userId' in apiShape.shape).toBe(true);
    expect('user_id' in apiShape.shape).toBe(false);
  });

  it('is a safe no-op for already-camelCase schema keys', () => {
    const apiShape = toApiShape(CamelCaseContract);
    expect(Object.keys(apiShape.shape)).toEqual(['id', 'userId', 'createdAt']);
  });

  it('leaves an underscore not followed by a lowercase letter untouched, matching toCamelCase exactly', () => {
    // toCamelCase's runtime regex (/_([a-z])/g) only collapses an
    // underscore immediately followed by a lowercase a-z letter. A digit
    // or a second underscore must NOT be collapsed — the type-level
    // transform has to agree with this exactly, not just "split on _".
    const DigitFieldContract = defineContract({
      name: 'Address',
      version: '1.0.0',
      description: 'test',
      schema: z.object({
        id: z.string(),
        address_2: z.string().optional(),
        foo__bar: z.string().optional(),
      }),
      operations: {},
      surfaces: { db: { table: 'addresses' } },
      authority: {},
    });

    const apiShape = toApiShape(DigitFieldContract);
    expect(Object.keys(apiShape.shape)).toEqual(['id', 'address_2', 'foo_Bar']);
  });

  it('preserves optional/default wrappers from the original field schema', () => {
    const apiShape = toApiShape(SnakeCaseContract);

    const withoutOptional = apiShape.safeParse({
      id: VALID_UUID,
      userId: VALID_UUID_2,
      quantity: 5,
      // expiryDate omitted — optional() must still allow this
    });
    expect(withoutOptional.success).toBe(true);

    const withoutDefault = apiShape.safeParse({
      id: VALID_UUID,
      userId: VALID_UUID_2,
      // quantity omitted — default(1) must still apply
    });
    expect(withoutDefault.success).toBe(true);
    if (withoutDefault.success) {
      expect(withoutDefault.data.quantity).toBe(1);
    }
  });

  it('rejects camelCase input with the wrong shape, same as the original schema would', () => {
    const apiShape = toApiShape(SnakeCaseContract);
    const result = apiShape.safeParse({ id: 'not-a-uuid', userId: VALID_UUID_2 });
    expect(result.success).toBe(false);
  });

  it('throws a clear error for a non-ZodObject schema', () => {
    const NotAnObject = defineContract({
      name: 'Scalar',
      version: '1.0.0',
      description: 'invalid for this generator',
      schema: z.string() as unknown as z.ZodObject<z.ZodRawShape>,
      operations: {},
      surfaces: { db: { table: 'scalars' } },
      authority: {},
    });
    expect(() => toApiShape(NotAnObject)).toThrow(/not a ZodObject/);
  });
});

describe('toDbShape (contracts#20)', () => {
  it('round-trips camelCase API input back to the contract’s DB column names', () => {
    const apiShape = toApiShape(SnakeCaseContract);
    const parsed = apiShape.parse({
      id: VALID_UUID,
      userId: VALID_UUID_2,
      expiryDate: '2026-01-01T00:00:00Z',
      quantity: 3,
    });

    const dbShape = toDbShape(SnakeCaseContract, parsed);

    expect(dbShape).toEqual({
      id: VALID_UUID,
      user_id: VALID_UUID_2,
      expiry_date: '2026-01-01T00:00:00Z',
      quantity: 3,
    });
  });

  it('produces keys matching extractColumns() column names exactly, not the raw schema key', () => {
    // CamelCaseContract's raw schema keys are already camelCase (userId),
    // but toDbShape's output must still be the DB column name (user_id).
    const apiShape = toApiShape(CamelCaseContract);
    const parsed = apiShape.parse({
      id: VALID_UUID,
      userId: VALID_UUID_2,
      createdAt: '2026-01-01T00:00:00Z',
    });

    const dbShape = toDbShape(CamelCaseContract, parsed);
    expect(Object.keys(dbShape).sort()).toEqual(['created_at', 'id', 'user_id']);
  });

  it('omits keys absent from the input rather than inserting undefined', () => {
    const dbShape = toDbShape(SnakeCaseContract, { id: VALID_UUID, userId: VALID_UUID_2 });
    expect(dbShape).toEqual({ id: VALID_UUID, user_id: VALID_UUID_2 });
    expect('expiry_date' in dbShape).toBe(false);
  });
});
