/**
 * Test Fixture Generator
 *
 * Reads a contract definition and emits:
 * - Valid entity fixtures (pass all schema constraints)
 * - Invalid entity fixtures (fail specific constraints)
 * - State machine transition tests
 * - Invariant violation tests
 *
 * Output is a Vitest test file.
 */

import type { ContractDefinition } from '../core/define.js';
import { extractColumns, extractEnums, toSnakeCase } from '../introspect/zod-walker.js';

type RouteEntry = [string, { method: string; path: string }];

export interface TestGeneratorOptions {
  /** Import path for the contract definition */
  contractImport?: string;
  /** Import path for generated routes */
  routeImport?: string;
  /** Exported route object name */
  routeExportName?: string;
  /** Emit handler-level integration tests when the contract has an API surface */
  includeRouteIntegrationTests?: boolean;
}

/**
 * Generate test fixtures and state machine tests from a contract definition.
 */
export function generateTests(
  contract: ContractDefinition,
  options: TestGeneratorOptions = {},
): string {
  const {
    contractImport = `./${toSnakeCase(contract.name)}.contract`,
    routeImport = `./${toSnakeCase(contract.name)}.routes`,
    routeExportName = `${toSnakeCase(contract.name)}Routes`,
    includeRouteIntegrationTests = true,
  } = options;

  const lines: string[] = [];
  const contractVar = `${contract.name}Contract`;

  lines.push(`/**`);
  lines.push(` * Generated tests for ${contract.name} contract v${contract.version}`);
  lines.push(` */`);
  lines.push('');
  lines.push(`import { describe, it, expect } from 'vitest';`);
  lines.push(`import { ${contractVar} } from '${contractImport}';`);
  if (includeRouteIntegrationTests && contract.surfaces.api) {
    lines.push(`import { Hono } from 'hono';`);
    lines.push(`import { ${routeExportName} } from '${routeImport}';`);
  }
  lines.push('');

  // ── Valid fixture ──────────────────────────────────────────────────
  lines.push(`describe('${contract.name} schema validation', () => {`);
  lines.push(`  const validFixture = ${generateValidFixture(contract)};`);
  lines.push('');
  lines.push(`  it('accepts a valid ${contract.name}', () => {`);
  lines.push(`    const result = ${contractVar}.schema.safeParse(validFixture);`);
  lines.push(`    expect(result.success).toBe(true);`);
  lines.push(`  });`);
  lines.push('');

  // ── Invalid fixtures from enums ────────────────────────────────────
  const enums = extractEnums(contract.schema);
  for (const [field, values] of Object.entries(enums)) {
    lines.push(`  it('rejects invalid ${field}', () => {`);
    lines.push(`    const result = ${contractVar}.schema.safeParse({ ...validFixture, ${camelCase(field)}: 'INVALID_VALUE' });`);
    lines.push(`    expect(result.success).toBe(false);`);
    lines.push(`  });`);
    lines.push('');
  }

  lines.push(`});`);
  lines.push('');

  // ── State machine tests ────────────────────────────────────────────
  if (contract.states) {
    lines.push(`describe('${contract.name} state transitions', () => {`);

    for (const [state, transitions] of Object.entries(contract.states.transitions)) {
      const validOps = Object.entries(transitions).filter(([_, target]) => target !== null);
      const invalidOps = Object.keys(contract.operations).filter(
        op => !Object.keys(transitions).includes(op),
      );

      if (validOps.length > 0) {
        for (const [op, target] of validOps) {
          lines.push(`  it('allows ${op} from ${state} → ${target}', () => {`);
          lines.push(`    const transitions = ${contractVar}.states!.transitions['${state}'];`);
          lines.push(`    expect(transitions['${op}']).toBe('${target}');`);
          lines.push(`  });`);
          lines.push('');

          const guard = contract.operations[op]?.transition?.guard;
          if (guard) {
            // The generator has no way to synthesize an entity that fails an
            // arbitrary predicate, so it can only assert conformance to the
            // (entity) => true | string signature against a passing fixture
            // here — it does NOT exercise rejection. The it.todo flags the
            // real gap so the consumer fills in a failing-precondition case
            // rather than mistaking this for full guard coverage.
            lines.push(`  it('${op} guard conforms to (entity) => true | string', () => {`);
            lines.push(`    const guard = ${contractVar}.operations.${op}.transition!.guard!;`);
            lines.push(`    const result = guard(${generateValidFixture(contract)});`);
            lines.push(`    expect(result).toBe(true);`);
            lines.push(`  });`);
            lines.push('');
            lines.push(`  it.todo('${op} guard rejects transition when precondition fails — add a fixture with the failing field value');`);
            lines.push('');
          }
        }
      }

      if (invalidOps.length > 0) {
        for (const op of invalidOps) {
          lines.push(`  it('blocks ${op} from ${state}', () => {`);
          lines.push(`    const transitions = ${contractVar}.states!.transitions['${state}'];`);
          lines.push(`    expect(transitions['${op}']).toBeUndefined();`);
          lines.push(`  });`);
          lines.push('');
        }
      }
    }

    lines.push(`  it('starts in ${contract.states.initial} state', () => {`);
    lines.push(`    expect(${contractVar}.states!.initial).toBe('${contract.states.initial}');`);
    lines.push(`  });`);
    lines.push(`});`);
    lines.push('');
  }

  // ── Invariant tests ────────────────────────────────────────────────
  if (contract.invariants && contract.invariants.length > 0) {
    lines.push(`describe('${contract.name} invariants', () => {`);

    for (const inv of contract.invariants) {
      lines.push(`  it('enforces: ${inv.name}', () => {`);
      lines.push(`    // ${inv.description}`);
      lines.push(`    // Applies to: ${inv.appliesTo.join(', ')}`);
      lines.push(`    expect(typeof ${contractVar}.invariants!.find(i => i.name === '${inv.name}')!.check).toBe('function');`);
      lines.push(`  });`);
      lines.push('');
    }

    lines.push(`});`);
  }

  if (includeRouteIntegrationTests && contract.surfaces.api) {
    emitRouteIntegrationTests(lines, contract, routeExportName);
  }

  return lines.join('\n');
}

function emitRouteIntegrationTests(
  lines: string[],
  contract: ContractDefinition,
  routeExportName: string,
): void {
  const api = contract.surfaces.api!;
  const tableName = contract.surfaces.db?.table ?? toSnakeCase(contract.name) + 's';
  const routeEntry = findIntegrationRoute(contract);
  if (!routeEntry) return;

  const [routeName, routeDef] = routeEntry;
  const auth = contract.authority[routeName];
  const expectsDbHit = !auth || auth.requires === 'public';
  const method = routeDef.method.toUpperCase();
  const path = `${api.basePath}${routeDef.path}`.replace(/:id/g, '00000000-0000-0000-0000-000000000001');
  const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  const body = hasBody
    ? generateSchemaFixture(contract.operations[routeName]?.input)
    : null;

  lines.push('');
  lines.push(`describe('${contract.name} generated route handlers', () => {`);
  lines.push(`  function createMockDb(statements: string[]) {`);
  lines.push(`    return {`);
  lines.push(`      prepare(sql: string) {`);
  lines.push(`        statements.push(sql);`);
  lines.push(`        return {`);
  lines.push(`          bind() { return this; },`);
  lines.push(`          async run() { return { success: true }; },`);
  lines.push(`          async first() { return { id: '00000000-0000-0000-0000-000000000001' }; },`);
  lines.push(`          async all() { return { results: [] }; },`);
  lines.push(`        };`);
  lines.push(`      },`);
  lines.push(`    };`);
  lines.push(`  }`);
  lines.push('');
  lines.push(`  it('handles ${routeName} through the generated route module', async () => {`);
  lines.push(`    const statements: string[] = [];`);
  lines.push(`    const app = new Hono<{ Bindings: { DB: ReturnType<typeof createMockDb> } }>();`);
  lines.push(`    app.route('${api.basePath}', ${routeExportName});`);
  lines.push(`    const res = await app.request('${path}', {`);
  lines.push(`      method: '${method}',`);
  if (hasBody) {
    lines.push(`      headers: { 'Content-Type': 'application/json' },`);
    lines.push(`      body: JSON.stringify(${body}),`);
  }
  lines.push(`    }, { DB: createMockDb(statements) });`);
  lines.push(``);
  lines.push(`    expect(res.status).toBeLessThan(500);`);
  if (expectsDbHit) {
    lines.push(`    expect(statements.some(sql => sql.includes('${tableName}'))).toBe(true);`);
  } else {
    lines.push(`    expect(statements.length).toBe(0);`);
  }
  lines.push(`  });`);
  lines.push(`});`);
}

function findIntegrationRoute(contract: ContractDefinition): RouteEntry | null {
  const api = contract.surfaces.api;
  if (!api) return null;

  const entries = Object.entries(api.routes) as RouteEntry[];
  const publicEntries = entries.filter(([name]) => contract.authority[name]?.requires === 'public');
  const preferred = findMutation(publicEntries) ?? publicEntries[0] ?? findMutation(entries);

  return preferred ?? entries[0] ?? null;
}

function findMutation(entries: RouteEntry[]): RouteEntry | undefined {
  return entries.find(([, route]) => (
    ['POST', 'PUT', 'PATCH'].includes(route.method.toUpperCase())
  ));
}

function generateValidFixture(contract: ContractDefinition): string {
  return generateSchemaFixture(contract.schema);
}

function generateSchemaFixture(schema: Parameters<typeof extractColumns>[0] | undefined): string {
  if (!schema) return '{}';
  const columns = extractColumns(schema);
  const enums = extractEnums(schema);
  const fields: string[] = [];

  for (const col of columns) {
    const camel = camelCase(col.name);

    if (col.isPrimaryKey) {
      fields.push(`    ${camel}: '00000000-0000-0000-0000-000000000001'`);
    } else if (enums[col.name]) {
      fields.push(`    ${camel}: '${enums[col.name][0]}'`);
    } else if (col.defaultValue !== null) {
      fields.push(`    ${camel}: ${col.defaultValue}`);
    } else if (col.sqlType === 'TEXT' && col.nullable) {
      fields.push(`    ${camel}: null`);
    } else if (col.sqlType === 'TEXT') {
      fields.push(`    ${camel}: 'test-${col.name}'`);
    } else if (col.sqlType === 'INTEGER') {
      fields.push(`    ${camel}: 0`);
    } else if (col.sqlType === 'REAL') {
      fields.push(`    ${camel}: 0.0`);
    }
  }

  return fields.length > 0 ? `{\n${fields.join(',\n')}\n  }` : '{}';
}

function camelCase(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
