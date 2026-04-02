/**
 * D1 Migration Generator
 *
 * Reads a contract definition and emits CREATE TABLE DDL with:
 * - Column types derived from Zod schema
 * - CHECK constraints from enums
 * - Foreign key references from ref() calls
 * - Indexes from surfaces.db.indexes
 * - DEFAULT values from Zod defaults
 * - NOT NULL from non-optional fields
 *
 * Output is valid SQLite/D1 SQL.
 */

import type { ContractDefinition } from '../core/define.js';
import { extractColumns, toSnakeCase } from '../introspect/zod-walker.js';

export interface SQLGeneratorOptions {
  /** Include DROP TABLE IF EXISTS before CREATE */
  dropFirst?: boolean;
  /** Include IF NOT EXISTS on CREATE TABLE */
  ifNotExists?: boolean;
  /** Table name override (defaults to contract surfaces.db.table) */
  tableName?: string;
}

/**
 * Generate D1 migration SQL from a contract definition.
 */
export function generateSQL(
  contract: ContractDefinition,
  options: SQLGeneratorOptions = {},
): string {
  const { dropFirst = false, ifNotExists = true } = options;
  const tableName = options.tableName ?? contract.surfaces.db?.table ?? toSnakeCase(contract.name) + 's';
  const columns = extractColumns(contract.schema);
  const lines: string[] = [];

  // Header comment
  lines.push(`-- Generated from ${contract.name} contract v${contract.version}`);
  lines.push(`-- ${contract.description}`);
  lines.push('');

  if (dropFirst) {
    lines.push(`DROP TABLE IF EXISTS ${tableName};`);
    lines.push('');
  }

  // CREATE TABLE
  const existsClause = ifNotExists ? 'IF NOT EXISTS ' : '';
  lines.push(`CREATE TABLE ${existsClause}${tableName} (`);

  const colDefs: string[] = [];
  const constraints: string[] = [];

  for (const col of columns) {
    let def = `  ${col.name} ${col.sqlType}`;

    if (col.isPrimaryKey) {
      def += ' PRIMARY KEY';
    }

    if (!col.nullable && !col.isPrimaryKey) {
      def += ' NOT NULL';
    }

    if (col.defaultValue !== null) {
      const val = formatDefault(col.defaultValue, col.sqlType);
      def += ` DEFAULT ${val}`;
    }

    colDefs.push(def);

    // CHECK constraint for enums
    if (col.checkConstraint) {
      constraints.push(`  ${col.checkConstraint}`);
    }
  }

  // Timestamp defaults
  const hasCreatedAt = columns.some(c => c.name === 'created_at');
  const hasUpdatedAt = columns.some(c => c.name === 'updated_at');

  // Join columns and constraints
  const allParts = [...colDefs, ...constraints];
  lines.push(allParts.join(',\n'));
  lines.push(');');
  lines.push('');

  // Indexes from surfaces.db.indexes
  const indexes = contract.surfaces.db?.indexes ?? [];
  for (const idx of indexes) {
    // Format: "idx_name(col1, col2)" or raw SQL
    const match = idx.match(/^(\w+)\((.+)\)$/);
    if (match) {
      lines.push(`CREATE INDEX ${existsClause}${match[1]} ON ${tableName}(${match[2]});`);
    } else {
      lines.push(`CREATE INDEX ${existsClause}${idx};`);
    }
  }

  if (indexes.length > 0) {
    lines.push('');
  }

  // Foreign key references (as comments — D1 doesn't enforce FK in all modes)
  const refs = columns.filter(c => c.isRef);
  if (refs.length > 0) {
    lines.push('-- Foreign key references (informational):');
    for (const col of refs) {
      lines.push(`-- ${col.name} → ${col.refTable}(${col.refField})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatDefault(value: string, sqlType: string): string {
  // JSON string values come through as '"value"'
  if (value.startsWith('"') && value.endsWith('"')) {
    return `'${value.slice(1, -1)}'`;
  }
  // Arrays/objects → JSON text
  if (value.startsWith('[') || value.startsWith('{')) {
    return `'${value}'`;
  }
  // Numeric
  if (sqlType === 'INTEGER' || sqlType === 'REAL') {
    return value;
  }
  return `'${value}'`;
}
