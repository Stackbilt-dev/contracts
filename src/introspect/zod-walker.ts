/**
 * Zod schema introspection — walks Zod type trees and extracts
 * column definitions, constraints, and relationships.
 *
 * Supports both Zod v3 and v4 internals. Consumers may pass schemas
 * created with either version; the walker detects the format and
 * adapts automatically.
 *
 * Ported from TarotScript's manifest property-type inference pattern.
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

// ── Zod version-agnostic helpers ────────────────────────────────────────

type AnyDef = Record<string, unknown>;

/**
 * Resolve type name from either Zod v3 (_def.typeName = "ZodString")
 * or Zod v4 (_def.type = "string"). Returns normalized v3-style names.
 */
function getTypeName(def: AnyDef): string {
  // v3: def.typeName = "ZodString", "ZodNumber", etc.
  if (typeof def.typeName === 'string' && def.typeName) return def.typeName;
  // v4: def.type = "string", "number", etc.
  if (typeof def.type === 'string' && def.type) {
    return 'Zod' + (def.type as string).charAt(0).toUpperCase() + (def.type as string).slice(1);
  }
  return '';
}

/**
 * Get shape entries from a ZodObject def.
 * v3: def.shape() is a function. v4: def.shape is a plain object.
 */
function getShape(def: AnyDef): Record<string, z.ZodType> | null {
  if (typeof def.shape === 'function') return (def.shape as () => Record<string, z.ZodType>)();
  if (def.shape && typeof def.shape === 'object') return def.shape as Record<string, z.ZodType>;
  return null;
}

/**
 * Get inner type from wrapper defs (optional, nullable, default).
 * Both v3 and v4 use _def.innerType.
 */
function getInnerType(def: AnyDef): z.ZodType | null {
  return (def.innerType as z.ZodType) ?? null;
}

/**
 * Get enum values.
 * v3: _def.values = ["a", "b"]. v4: _def.entries = { a: "a", b: "b" }.
 */
function getEnumValues(def: AnyDef): string[] | null {
  if (Array.isArray(def.values)) return def.values as string[];
  if (def.entries && typeof def.entries === 'object') return Object.values(def.entries as Record<string, string>);
  return null;
}

/**
 * Check if a number type has an integer constraint.
 * v3: checks: [{ kind: "int" }]. v4: checks: [{ isInt: true }].
 */
function hasIntCheck(def: AnyDef): boolean {
  const checks = def.checks as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(checks)) return false;
  return checks.some(c => c.kind === 'int' || c.isInt === true);
}

/**
 * Get default value. v3: _def.defaultValue is a function. v4: raw value.
 */
function getDefaultValue(def: AnyDef): unknown | undefined {
  if (def.defaultValue === undefined) return undefined;
  if (typeof def.defaultValue === 'function') return (def.defaultValue as () => unknown)();
  return def.defaultValue;
}

// ── Schema unwrapping ───────────────────────────────────────────────────

function unwrap(schema: z.ZodType): { inner: z.ZodType; nullable: boolean; defaultValue: string | null } {
  let nullable = false;
  let defaultValue: string | null = null;
  let current = schema;

  // Peel off wrappers: optional, nullable, default
  for (let i = 0; i < 10; i++) {
    const def = current._def as AnyDef;
    const typeName = getTypeName(def);

    if (typeName === 'ZodOptional' || typeName === 'ZodNullable') {
      nullable = true;
      const inner = getInnerType(def);
      if (!inner) break;
      current = inner;
    } else if (typeName === 'ZodDefault') {
      const raw = getDefaultValue(def);
      defaultValue = raw === undefined ? null : JSON.stringify(raw);
      const inner = getInnerType(def);
      if (!inner) break;
      current = inner;
    } else {
      break;
    }
  }

  return { inner: current, nullable, defaultValue };
}

// ── Type mapping ────────────────────────────────────────────────────────

function zodToSqlType(schema: z.ZodType): string {
  const def = schema._def as AnyDef;
  const typeName = getTypeName(def);

  switch (typeName) {
    case 'ZodString':
      return 'TEXT';
    case 'ZodNumber': {
      return hasIntCheck(def) ? 'INTEGER' : 'REAL';
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

function extractEnumValuesFromSchema(schema: z.ZodType): string[] | null {
  const def = schema._def as AnyDef;
  if (getTypeName(def) !== 'ZodEnum') return null;
  return getEnumValues(def);
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
  const def = schema._def as AnyDef;

  if (getTypeName(def) !== 'ZodObject') return [];

  const shape = getShape(def);
  if (!shape) return [];

  return Object.entries(shape).map(([key, fieldSchema]) => {
    const { inner, nullable, defaultValue } = unwrap(fieldSchema);
    const ref = extractRef(inner);
    const enumValues = extractEnumValuesFromSchema(inner);
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

/**
 * Extract all enum fields and their allowed values from a contract schema.
 */
export function extractEnums(schema: z.ZodType): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const def = schema._def as AnyDef;

  if (getTypeName(def) !== 'ZodObject') return result;

  const shape = getShape(def);
  if (!shape) return result;

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const { inner } = unwrap(fieldSchema);
    const values = extractEnumValuesFromSchema(inner);
    if (values) {
      result[toSnakeCase(key)] = values;
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
