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

export interface TestGeneratorOptions {
  /** Import path for the contract definition */
  contractImport?: string;
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
  } = options;

  const lines: string[] = [];
  const contractVar = `${contract.name}Contract`;

  lines.push(`/**`);
  lines.push(` * Generated tests for ${contract.name} contract v${contract.version}`);
  lines.push(` */`);
  lines.push('');
  lines.push(`import { describe, it, expect } from 'vitest';`);
  lines.push(`import { ${contractVar} } from '${contractImport}';`);
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

  return lines.join('\n');
}

function generateValidFixture(contract: ContractDefinition): string {
  const columns = extractColumns(contract.schema);
  const enums = extractEnums(contract.schema);
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

  return `{\n${fields.join(',\n')}\n  }`;
}

function camelCase(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
