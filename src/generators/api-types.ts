/**
 * API Types Generator
 *
 * Emits TypeScript type definitions for the API surface of a contract:
 * - Entity type with camelCase field names (matches z.infer output)
 * - Input types for each operation (create, update, etc.)
 * - Response wrapper types
 *
 * Contracts should define schema fields in camelCase — extractColumns()
 * converts them to snake_case for DB. If a contract uses snake_case field
 * names, toCamelCase() is applied to produce the API-surface types.
 */

import type { ContractDefinition } from '../core/define.js';
import { extractColumns, toCamelCase, toSnakeCase } from '../introspect/zod-walker.js';
import { z } from 'zod';

export interface ApiTypesGeneratorOptions {
  /** Module name prefix for generated types (defaults to contract.name) */
  typeName?: string;
}

/**
 * Generate TypeScript type definitions for the API surface of a contract.
 *
 * Output is a .ts string that can be saved as a type declaration file
 * alongside the consumer's route definitions.
 */
export function generateApiTypes(
  contract: ContractDefinition,
  options: ApiTypesGeneratorOptions = {},
): string {
  const typeName = options.typeName ?? contract.name;
  const columns = extractColumns(contract.schema);
  const lines: string[] = [];

  lines.push(`// API types for ${typeName} — generated from @stackbilt/contracts`);
  lines.push(`// Contract version: ${contract.version}`);
  lines.push('');

  // Entity type (camelCase — what z.infer produces, or converted from snake_case)
  lines.push(`export interface ${typeName} {`);
  for (const col of columns) {
    const fieldName = toCamelCase(col.name);
    const tsType = sqlTypeToTs(col.sqlType, col.checkConstraint);
    const optional = col.nullable || col.defaultValue !== null ? '?' : '';
    lines.push(`  ${fieldName}${optional}: ${tsType};`);
  }
  lines.push('}');
  lines.push('');

  // Operation input types
  for (const [opName, op] of Object.entries(contract.operations)) {
    const inputTypeName = `${typeName}${capitalize(opName)}Input`;
    const outputTypeName = `${typeName}${capitalize(opName)}Output`;

    lines.push(`export interface ${inputTypeName} ${zodObjectToInterface(op.input)}`);
    lines.push('');

    if (op.output !== 'self') {
      lines.push(`export interface ${outputTypeName} ${zodObjectToInterface(op.output as z.ZodType)}`);
      lines.push('');
    } else {
      lines.push(`export type ${outputTypeName} = ${typeName};`);
      lines.push('');
    }
  }

  // Route path constants (derived from surfaces.api)
  const api = contract.surfaces.api;
  if (api) {
    lines.push(`export const ${toSnakeCase(typeName).toUpperCase()}_ROUTES = {`);
    lines.push(`  basePath: '${api.basePath}',`);
    lines.push('  paths: {');
    for (const [name, route] of Object.entries(api.routes)) {
      lines.push(`    ${name}: { method: '${route.method}', path: '${route.path}' },`);
    }
    lines.push('  },');
    lines.push('} as const;');
    lines.push('');
  }

  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sqlTypeToTs(sqlType: string, checkConstraint: string | null): string {
  if (checkConstraint) {
    // Extract enum values from CHECK (field IN ('a', 'b', 'c'))
    const match = checkConstraint.match(/IN \(([^)]+)\)/);
    if (match) {
      const values = match[1].split(',').map(v => v.trim().replace(/^'|'$/g, ''));
      return values.map(v => `'${v}'`).join(' | ');
    }
  }
  switch (sqlType) {
    case 'INTEGER': return 'number';
    case 'REAL':    return 'number';
    default:        return 'string';
  }
}

function zodObjectToInterface(schema: z.ZodType): string {
  // Best-effort: walk the Zod object shape and emit an interface body.
  // We reuse the column extractor but map back to camelCase.
  try {
    const def = schema._def as unknown as Record<string, unknown>;
    let shape: Record<string, z.ZodType> | null = null;

    if (typeof def.shape === 'function') {
      shape = (def.shape as () => Record<string, z.ZodType>)();
    } else if (def.shape && typeof def.shape === 'object') {
      shape = def.shape as Record<string, z.ZodType>;
    }

    if (!shape) return '{}';

    const fields: string[] = [];
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const { optional, tsType } = inferTsType(fieldSchema);
      fields.push(`  ${key}${optional ? '?' : ''}: ${tsType};`);
    }

    return `{\n${fields.join('\n')}\n}`;
  } catch {
    return '{}';
  }
}

function inferTsType(schema: z.ZodType): { tsType: string; optional: boolean } {
  const def = schema._def as unknown as Record<string, unknown>;
  const typeName = getTypeName(def);

  if (typeName === 'ZodOptional') {
    const inner = inferTsType((def.innerType as z.ZodType));
    return { tsType: inner.tsType, optional: true };
  }
  if (typeName === 'ZodNullable') {
    const inner = inferTsType((def.innerType as z.ZodType));
    return { tsType: `${inner.tsType} | null`, optional: false };
  }
  if (typeName === 'ZodDefault') {
    const inner = inferTsType((def.innerType as z.ZodType));
    return { tsType: inner.tsType, optional: true };
  }
  if (typeName === 'ZodString') return { tsType: 'string', optional: false };
  if (typeName === 'ZodNumber') return { tsType: 'number', optional: false };
  if (typeName === 'ZodBoolean') return { tsType: 'boolean', optional: false };
  if (typeName === 'ZodArray') return { tsType: 'unknown[]', optional: false };
  if (typeName === 'ZodObject') return { tsType: 'Record<string, unknown>', optional: false };
  if (typeName === 'ZodEnum') {
    const values = getEnumValues(def);
    if (values) return { tsType: values.map(v => `'${v}'`).join(' | '), optional: false };
  }
  return { tsType: 'unknown', optional: false };
}

function getTypeName(def: Record<string, unknown>): string {
  if (typeof def.typeName === 'string' && def.typeName) return def.typeName;
  if (typeof def.type === 'string' && def.type) {
    return 'Zod' + (def.type as string).charAt(0).toUpperCase() + (def.type as string).slice(1);
  }
  return '';
}

function getEnumValues(def: Record<string, unknown>): string[] | null {
  if (Array.isArray(def.values)) return def.values as string[];
  if (def.entries && typeof def.entries === 'object') return Object.values(def.entries as Record<string, string>);
  return null;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
