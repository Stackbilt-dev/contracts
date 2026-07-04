/**
 * FoodFiles v2 SQL Diff Validator
 *
 * Closes contracts#1. Runs generateSQL() against each FoodFiles contract
 * and diffs the output against the corresponding migration file. The
 * delta is the primary feedback loop for generator accuracy.
 *
 * Usage:
 *   FOODFILES_PATH=../foodfilesapi_v2 npx vitest run tests/foodfiles-sql-diff.test.ts
 *
 * If FOODFILES_PATH is unset, the whole suite is skipped (so CI runs
 * without a hard dependency on having the FoodFiles repo checked out).
 *
 * What this checks per contract → migration pair:
 *  - Column-name set parity (added / missing / renamed signals)
 *  - SQLite type parity (TEXT/INTEGER/REAL/BLOB)
 *  - NOT NULL parity
 *  - DEFAULT-value presence parity
 *
 * What this intentionally doesn't check:
 *  - Index shape (surfaces.db.indexes maps loosely to migration CREATE INDEX)
 *  - Foreign keys (generator doesn't yet emit REFERENCES)
 *  - CHECK constraints (generator v0.1 doesn't emit from z.enum)
 *  These land in contracts#2 / #3 and will gate on this signal.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import { pathToFileURL } from 'url';
import { generateSQL } from '../src/generators/sql.js';
import type { ContractDefinition } from '../src/core/define.js';

const FOODFILES_PATH = process.env.FOODFILES_PATH ?? '../foodfilesapi_v2';
const CONTRACTS_DIR = resolve(FOODFILES_PATH, 'apps/api/src/contracts');
const MIGRATIONS_DIR = resolve(FOODFILES_PATH, 'apps/api/db/migrations');

const hasFoodFiles = existsSync(CONTRACTS_DIR) && existsSync(MIGRATIONS_DIR);

/**
 * Known drifts as of the initial validator run (2026-04-11).
 *
 * Each entry is a `contract.columnName: issue-prefix` key. The issue in
 * runtime is matched against this prefix to allow generator tuning
 * without burning CI churn on stable known-drift lines.
 *
 * When fixing a drift, DELETE the corresponding allowlist entry so
 * regressions trigger a CI failure. When a new drift appears, investigate
 * first — don't just add it here.
 *
 * Inventory of opening drift signal:
 *  - MealPlan.servings: contract says optional-ish via zod default? but migration
 *    allows NULL. Needs a zod schema review.
 *  - MealPlan.created_at / updated_at: contract requires NOT NULL; migration
 *    allows NULL. Migration drift — migration should be tightened.
 *  - PantryItem.location / created_at / updated_at: same NOT NULL mismatch.
 */
const KNOWN_DRIFTS: Record<string, string[]> = {
  MealPlan: [
    'servings:NOT NULL drift',
    'created_at:NOT NULL drift',
    'updated_at:NOT NULL drift',
  ],
  PantryItem: [
    'location:NOT NULL drift',
    'created_at:NOT NULL drift',
    'updated_at:NOT NULL drift',
  ],
};

interface ParsedColumn {
  name: string;
  type: string;
  notNull: boolean;
  hasDefault: boolean;
  isPrimaryKey: boolean;
}

interface ParsedTable {
  name: string;
  columns: Map<string, ParsedColumn>;
}

/**
 * Best-effort CREATE TABLE parser. SQLite-specific. Handles the dialect
 * used by FoodFiles migrations (column per line, PRAGMA header, trailing
 * CREATE INDEX statements). Not a full parser — picks up the 90% case.
 */
function parseCreateTables(sql: string): ParsedTable[] {
  const tables: ParsedTable[] = [];
  const stripped = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\);/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(stripped)) !== null) {
    const name = match[1]!;
    const body = match[2]!;
    const columns = new Map<string, ParsedColumn>();

    // Split body by commas that are not inside parentheses (DEFAULTs like
    // `strftime('%Y', 'now')` contain nested parens and commas).
    const lines: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of body) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        lines.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) lines.push(current.trim());

    for (const line of lines) {
      // Skip table-level constraints (PRIMARY KEY (x, y), FOREIGN KEY..., UNIQUE (...), CHECK (...))
      if (/^(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line)) continue;
      const colMatch = line.match(/^(\w+)\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/i);
      if (!colMatch) continue;
      const colName = colMatch[1]!;
      const colType = colMatch[2]!.toUpperCase();
      const notNull = /\bNOT\s+NULL\b/i.test(line);
      const hasDefault = /\bDEFAULT\b/i.test(line);
      const isPrimaryKey = /\bPRIMARY\s+KEY\b/i.test(line);
      columns.set(colName, { name: colName, type: colType, notNull, hasDefault, isPrimaryKey });
    }

    tables.push({ name, columns });
  }
  return tables;
}

function parseGeneratedTable(sql: string): ParsedTable | null {
  const tables = parseCreateTables(sql);
  return tables[0] ?? null;
}

interface ColumnDrift {
  column: string;
  issue: string;
}

function diffTables(generated: ParsedTable, migration: ParsedTable): ColumnDrift[] {
  const drifts: ColumnDrift[] = [];

  for (const [name, gen] of generated.columns) {
    const mig = migration.columns.get(name);
    if (!mig) {
      drifts.push({ column: name, issue: 'missing in migration' });
      continue;
    }
    if (gen.type !== mig.type) {
      drifts.push({ column: name, issue: `type drift: generated=${gen.type} migration=${mig.type}` });
    }
    if (gen.notNull !== mig.notNull) {
      drifts.push({
        column: name,
        issue: `NOT NULL drift: generated=${gen.notNull} migration=${mig.notNull}`,
      });
    }
    if (gen.hasDefault !== mig.hasDefault) {
      drifts.push({
        column: name,
        issue: `DEFAULT drift: generated=${gen.hasDefault} migration=${mig.hasDefault}`,
      });
    }
  }

  for (const [name] of migration.columns) {
    if (!generated.columns.has(name)) {
      drifts.push({ column: name, issue: 'missing in generated (extra in migration)' });
    }
  }

  return drifts;
}

async function loadContract(filePath: string): Promise<ContractDefinition | null> {
  try {
    const mod = await import(pathToFileURL(filePath).href);
    // A contract file exports one defineContract() result. Find the first
    // exported value that looks like a ContractDefinition.
    for (const value of Object.values(mod)) {
      if (
        value &&
        typeof value === 'object' &&
        'name' in value &&
        'version' in value &&
        'schema' in value &&
        'surfaces' in value
      ) {
        return value as ContractDefinition;
      }
    }
  } catch (err) {
    console.warn(`[foodfiles-diff] failed to load ${basename(filePath)}: ${(err as Error).message}`);
  }
  return null;
}

function loadAllMigrationTables(): Map<string, ParsedTable> {
  const tables = new Map<string, ParsedTable>();
  const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    for (const table of parseCreateTables(sql)) {
      // Later migrations may rename/replace; last write wins.
      tables.set(table.name, table);
    }
  }
  return tables;
}

describe.skipIf(!hasFoodFiles)('FoodFiles SQL diff', () => {
  const migrationTables = hasFoodFiles ? loadAllMigrationTables() : new Map();

  const contractFiles = hasFoodFiles
    ? readdirSync(CONTRACTS_DIR)
        .filter(f => f.endsWith('.contract.ts'))
        .map(f => resolve(CONTRACTS_DIR, f))
    : [];

  for (const contractFile of contractFiles) {
    it(`${basename(contractFile)} matches migration`, async () => {
      const contract = await loadContract(contractFile);
      if (!contract) {
        throw new Error(`could not load contract from ${basename(contractFile)}`);
      }

      const generatedSQL = generateSQL(contract, { ifNotExists: true });
      const generated = parseGeneratedTable(generatedSQL);
      expect(generated, 'generated SQL must contain one CREATE TABLE').not.toBeNull();

      const migration = migrationTables.get(generated!.name);
      expect(
        migration,
        `no CREATE TABLE ${generated!.name} found in migrations/ (contract.surfaces.db.table may be wrong)`
      ).toBeDefined();

      const drifts = diffTables(generated!, migration!);
      const allowed = KNOWN_DRIFTS[contract.name] ?? [];
      const unexpected = drifts.filter(d => {
        const key = `${d.column}:${d.issue}`;
        return !allowed.some(prefix => key.startsWith(prefix));
      });

      if (unexpected.length > 0) {
        const report = unexpected.map(d => `  - ${d.column}: ${d.issue}`).join('\n');
        throw new Error(
          `${contract.name} has ${unexpected.length} unexpected drift(s) vs migration table ${generated!.name}:\n${report}\n\n` +
          `If this is a new legitimate drift, add it to KNOWN_DRIFTS. ` +
          `If it's a regression, fix the contract or migration.`
        );
      }

      // Report known drifts for visibility (don't fail)
      if (drifts.length > 0) {
        console.log(
          `[foodfiles-diff] ${contract.name}: ${drifts.length} known drift(s) — ` +
          drifts.map(d => `${d.column}(${d.issue.split(':')[0]})`).join(', ')
        );
      }
    });
  }
});
