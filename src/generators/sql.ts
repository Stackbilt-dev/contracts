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

import type { ContractDefinition, DbSurface } from '../core/define.js';
import { extractColumns, toSnakeCase } from '../introspect/zod-walker.js';

/**
 * columnOverrides keys are written against the contract's schema field
 * names (commonly camelCase), but ColumnDef.name is always toSnakeCase()'d.
 * Re-key by snake_case so lookups by col.name always match regardless of
 * how the override key was written.
 */
function normalizeColumnOverrides(
  columnOverrides: DbSurface['columnOverrides'],
): Record<string, { default?: string }> {
  const result: Record<string, { default?: string }> = {};
  for (const [key, value] of Object.entries(columnOverrides ?? {})) {
    result[toSnakeCase(key)] = value;
  }
  return result;
}

export interface SQLGeneratorOptions {
  /** Include DROP TABLE IF EXISTS before CREATE */
  dropFirst?: boolean;
  /** Include IF NOT EXISTS on CREATE TABLE */
  ifNotExists?: boolean;
  /** Table name override (defaults to contract surfaces.db.table) */
  tableName?: string;
}

export interface MigrationGeneratorOptions {
  /**
   * Column names currently in the production table (from PRAGMA table_info
   * or your migration ledger). New columns in the contract not in this list
   * will be emitted as ALTER TABLE ADD COLUMN statements.
   */
  existingColumns: string[];
  /** Table name override */
  tableName?: string;
}

/**
 * Generate ALTER TABLE migration SQL for an existing production table.
 *
 * Diffs the contract schema against existingColumns and emits:
 * - ALTER TABLE ... ADD COLUMN ... for new columns
 * - Comments for columns present in prod but absent from the contract
 *   (D1 cannot DROP COLUMN; operator must decide manually)
 *
 * Returns an empty migration (comment only) if no new columns are found.
 */
export function generateMigration(
  contract: ContractDefinition,
  options: MigrationGeneratorOptions,
): string {
  const tableName = options.tableName ?? contract.surfaces.db?.table ?? toSnakeCase(contract.name) + 's';
  const columns = extractColumns(contract.schema);
  const colOverrides = normalizeColumnOverrides(contract.surfaces.db?.columnOverrides);
  const existingSet = new Set(options.existingColumns.map(c => c.toLowerCase()));

  const newCols = columns.filter(c => !existingSet.has(c.name.toLowerCase()));
  const contractColSet = new Set(columns.map(c => c.name.toLowerCase()));
  const removedCols = options.existingColumns.filter(c => !contractColSet.has(c.toLowerCase()));

  const lines: string[] = [];
  lines.push(`-- ALTER TABLE migration for ${tableName}`);
  lines.push(`-- Generated from ${contract.name} contract v${contract.version}`);
  lines.push('');

  if (newCols.length === 0) {
    lines.push('-- No new columns detected. Schema is up to date.');
    if (removedCols.length > 0) {
      lines.push('');
      lines.push('-- Columns in prod not in contract (manual review required):');
      for (const col of removedCols) {
        lines.push(`--   ${col} (D1 cannot DROP COLUMN)`);
      }
    }
    return lines.join('\n');
  }

  lines.push('-- New columns to add:');
  for (const col of newCols) {
    let stmt = `ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.sqlType}`;

    if (!col.nullable && !col.isPrimaryKey) {
      // D1 requires NOT NULL ADD COLUMN to have a DEFAULT
      const override = colOverrides[col.name];
      const hasDefault = override?.default || col.defaultValue !== null;
      if (hasDefault) {
        stmt += ' NOT NULL';
      }
      // If no default, omit NOT NULL — ADD COLUMN without DEFAULT cannot be NOT NULL in SQLite
    }

    const override = colOverrides[col.name];
    if (override?.default) {
      stmt += ` DEFAULT ${override.default}`;
    } else if (col.defaultValue !== null) {
      stmt += ` DEFAULT ${formatDefault(col.defaultValue, col.sqlType)}`;
    }

    if (col.checkConstraint) {
      stmt += ` CHECK (${col.name} IN (${col.checkConstraint.match(/IN \((.+)\)/)?.[1] ?? ''}))`;
    }

    lines.push(`${stmt};`);
  }

  if (removedCols.length > 0) {
    lines.push('');
    lines.push('-- Columns in prod not in contract (no action — D1 cannot DROP COLUMN):');
    for (const col of removedCols) {
      lines.push(`--   ${col}`);
    }
  }

  lines.push('');
  return lines.join('\n');
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
  const uniqueCols = new Set(contract.surfaces.db?.uniqueColumns ?? []);
  const colOverrides = normalizeColumnOverrides(contract.surfaces.db?.columnOverrides);
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

    if (uniqueCols.has(col.name)) {
      def += ' UNIQUE';
    }

    // SQL-expression override takes priority over Zod default
    const override = colOverrides[col.name];
    if (override?.default) {
      def += ` DEFAULT ${override.default}`;
    } else if (col.defaultValue !== null) {
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
  // Zod booleans map to INTEGER (SQLite has no native BOOLEAN type); the
  // convention used everywhere else in this codebase's hand-written D1
  // migrations is the 0/1 literal, not the true/false keyword alias.
  if (value === 'true' || value === 'false') {
    return value === 'true' ? '1' : '0';
  }
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
