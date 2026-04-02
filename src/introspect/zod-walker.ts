/**
 * Zod schema introspection — walks Zod type trees and extracts
 * column definitions, constraints, and relationships.
 *
 * Ported from TarotScript's manifest property-type inference pattern.
 * Instead of inferring types from card properties, we extract SQL
 * column types and constraints from Zod schema definitions.
 */

import { z } from 'zod';

// ── Column types ─────────────────────────────────────────────────────────

export interface ColumnDef {
  name: string;
  sqlType: string;
  nullable: boolean;
  defaultValue: string | null;
  checkConstraint: string | null;
  isPrimaryKey: boolean;
  isRef: boolean;
  refTable: string | null;
  refField: string | null;
}

// ── Zod type detection ───────────────────────────────────────────────────

type ZodDef = z.ZodType['_def'];

function unwrap(schema: z.ZodType): { inner: z.ZodType; nullable: boolean; defaultValue: string | null } {
  let nullable = false;
  let defaultValue: string | null = null;
  let current = schema;

  // Peel off wrappers: optional, nullable, default
  for (let i = 0; i < 10; i++) {
    const def = current._def as ZodDef & { typeName?: string; innerType?: z.ZodType; defaultValue?: () => unknown };
    const typeName = def.typeName ?? '';

    if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
      nullable = true;
      current = def.innerType!;
    } else if (typeName === 'ZodDefault') {
      const raw = def.defaultValue?.();
      defaultValue = raw === undefined ? null : JSON.stringify(raw);
      current = def.innerType!;
    } else {
      break;
    }
  }

  return { inner: current, nullable, defaultValue };
}

function zodToSqlType(schema: z.ZodType): string {
  const def = schema._def as ZodDef & { typeName?: string; checks?: Array<{ kind: string }> };
  const typeName = def.typeName ?? '';

  switch (typeName) {
    case 'ZodString':
      return 'TEXT';
    case 'ZodNumber': {
      const isInt = def.checks?.some((c: { kind: string }) => c.kind === 'int');
      return isInt ? 'INTEGER' : 'REAL';
    }
    case 'ZodBoolean':
      return 'INTEGER'; // SQLite boolean
    case 'ZodEnum':
      return 'TEXT';
    case 'ZodArray':
      return 'TEXT'; // JSON serialized
    case 'ZodObject':
      return 'TEXT'; // JSON serialized
    default:
      return 'TEXT';
  }
}

function extractEnumValues(schema: z.ZodType): string[] | null {
  const def = schema._def as ZodDef & { typeName?: string; values?: string[] };
  if (def.typeName === 'ZodEnum' && Array.isArray(def.values)) {
    return def.values;
  }
  return null;
}

function extractRef(schema: z.ZodType): { table: string; field: string } | null {
  const s = schema as z.ZodType & { __ref?: { contract: { surfaces: { db?: { table: string } }; name: string }; field: string } };
  if (s.__ref) {
    const table = s.__ref.contract.surfaces?.db?.table ?? toSnakeCase(s.__ref.contract.name) + 's';
    return { table, field: s.__ref.field };
  }
  return null;
}

// ── Schema walking ───────────────────────────────────────────────────────

/**
 * Walk a Zod object schema and extract column definitions for D1.
 */
export function extractColumns(schema: z.ZodType): ColumnDef[] {
  const def = schema._def as ZodDef & { typeName?: string; shape?: () => Record<string, z.ZodType> };

  // Handle ZodObject
  if (def.typeName === 'ZodObject' && def.shape) {
    const shape = def.shape();
    return Object.entries(shape).map(([key, fieldSchema]) => {
      const { inner, nullable, defaultValue } = unwrap(fieldSchema);
      const ref = extractRef(inner);
      const enumValues = extractEnumValues(inner);
      const sqlType = zodToSqlType(inner);

      let checkConstraint: string | null = null;
      if (enumValues) {
        const escaped = enumValues.map(v => `'${v}'`).join(', ');
        checkConstraint = `CHECK (${toSnakeCase(key)} IN (${escaped}))`;
      }

      return {
        name: toSnakeCase(key),
        sqlType,
        nullable,
        defaultValue,
        checkConstraint,
        isPrimaryKey: key === 'id',
        isRef: !!ref,
        refTable: ref?.table ?? null,
        refField: ref ? toSnakeCase(ref.field) : null,
      };
    });
  }

  return [];
}

/**
 * Extract all enum fields and their allowed values from a contract schema.
 */
export function extractEnums(schema: z.ZodType): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const def = schema._def as ZodDef & { typeName?: string; shape?: () => Record<string, z.ZodType> };

  if (def.typeName === 'ZodObject' && def.shape) {
    const shape = def.shape();
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const { inner } = unwrap(fieldSchema);
      const values = extractEnumValues(inner);
      if (values) {
        result[toSnakeCase(key)] = values;
      }
    }
  }

  return result;
}

// ── Utilities ────────────────────────────────────────────────────────────

export function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}
