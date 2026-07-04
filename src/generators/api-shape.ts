/**
 * API Shape Generator
 *
 * Runtime camelCase projection of a contract's schema, as an actual Zod
 * schema — not a TypeScript type declaration (see generators/api-types.ts
 * for that). Where generateApiTypes() emits compile-time-only interface
 * strings, toApiShape() returns something you can call .parse()/.safeParse()
 * on at request time, closing the gap that otherwise forces consumers to
 * hand-roll a camelCase Zod object per service file (contracts#20).
 */

import { z } from 'zod';
import type { ContractDefinition } from '../core/define.js';
import { getObjectShape, toCamelCase, toSnakeCase } from '../introspect/zod-walker.js';

// ── Type-level camelCase transform ──────────────────────────────────────
//
// Mirrors toCamelCase()'s runtime regex — /_([a-z])/g, which only collapses
// an underscore immediately followed by a lowercase a-z letter — at the type
// level, so z.infer<ReturnType<typeof toApiShape<...>>> actually reports the
// same keys the runtime produces. A naive "split on any underscore" type
// disagrees with the runtime on keys like `address_2` (digit, not a letter,
// follows the underscore) or `foo__bar` (double underscore): the runtime
// leaves the non-letter-prefixed underscore untouched, so the type must too.
// Processes one character at a time (not split-on-`_`) to mirror the regex
// engine's left-to-right, advance-on-no-match scan exactly, including the
// double-underscore case.

type LowerAlpha =
  | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
  | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z';

type SnakeToCamel<S extends string> = S extends `${infer First}${infer Rest}`
  ? First extends '_'
    ? Rest extends `${infer Next}${infer Tail}`
      ? Next extends LowerAlpha
        ? `${Uppercase<Next>}${SnakeToCamel<Tail>}`
        : `_${SnakeToCamel<Rest>}`
      : '_'
    : `${First}${SnakeToCamel<Rest>}`
  : S;

type CamelCaseShape<Shape> = {
  [K in keyof Shape as K extends string ? SnakeToCamel<K> : K]: Shape[K];
};

type ShapeOf<TSchema> = TSchema extends z.ZodObject<infer Shape, infer _Config> ? Shape : never;

/**
 * Runtime camelCase projection of contract.schema. Reuses the original
 * field schema instances by reference (not re-derived), so optional/
 * default/ref() wrappers on each field are preserved for free — this is a
 * key rename, not a schema re-validation.
 *
 * Field names that are already camelCase in the contract's own schema pass
 * through unchanged (toCamelCase is idempotent on inputs with no
 * underscores), so this is safe to call on contracts written in either
 * convention.
 */
export function toApiShape<T extends ContractDefinition>(
  contract: T,
): z.ZodObject<CamelCaseShape<ShapeOf<T['schema']>>> {
  const shape = getObjectShape(contract.schema);
  if (!shape) {
    throw new Error(`toApiShape: ${contract.name}.schema is not a ZodObject`);
  }

  const apiShape: Record<string, z.ZodType> = {};
  for (const [key, fieldSchema] of Object.entries(shape)) {
    apiShape[toCamelCase(key)] = fieldSchema;
  }

  return z.object(apiShape) as unknown as z.ZodObject<CamelCaseShape<ShapeOf<T['schema']>>>;
}

/**
 * Inverse of toApiShape(): remaps camelCase API input keys back to the
 * contract's actual DB column names (always snake_case, matching
 * extractColumns()'s output) — not the contract's raw schema key, which may
 * already be camelCase. The result is directly usable for a D1 write
 * (`db.prepare('INSERT INTO t (col1, col2) ...')`).
 *
 * Mechanical key rename only — does not validate. Parse with
 * toApiShape(contract) (or the contract's own operation input schema)
 * first if the input isn't already trusted.
 */
export function toDbShape<T extends ContractDefinition>(
  contract: T,
  apiInput: Record<string, unknown>,
): Record<string, unknown> {
  const shape = getObjectShape(contract.schema);
  if (!shape) {
    throw new Error(`toDbShape: ${contract.name}.schema is not a ZodObject`);
  }

  const dbInput: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    const camelKey = toCamelCase(key);
    if (camelKey in apiInput) {
      dbInput[toSnakeCase(key)] = apiInput[camelKey];
    }
  }

  return dbInput;
}
