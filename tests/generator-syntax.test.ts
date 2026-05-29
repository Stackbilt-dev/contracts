import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineContract } from '../src/core/define.js';
import { generateRoutes } from '../src/generators/routes.js';
import { generateSDK } from '../src/generators/sdk.js';
import { generateTests } from '../src/generators/tests.js';

const SyntaxContract = defineContract({
  name: 'Syntax',
  version: '1.0.0',
  description: 'Contract used to verify generated TypeScript syntax',
  schema: z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(['draft', 'published']),
  }),
  operations: {
    create: {
      input: z.object({ title: z.string() }),
      output: 'self',
      emits: ['syntax.created'],
    },
    publish: {
      input: z.object({}),
      output: 'self',
      transition: { from: 'draft', to: 'published' },
      emits: ['syntax.published'],
    },
  },
  states: {
    field: 'status',
    initial: 'draft',
    transitions: {
      draft: { publish: 'published' },
      published: {},
    },
  },
  surfaces: {
    api: {
      basePath: '/api/syntax',
      routes: {
        create: { method: 'POST', path: '/' },
        publish: { method: 'POST', path: '/:id/publish' },
      },
    },
    db: { table: 'syntax_items' },
  },
  authority: {
    create: { requires: 'public' },
    publish: { requires: 'public' },
  },
});

function expectTranspiles(source: string): void {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });

  expect(result.diagnostics ?? []).toEqual([]);
}

describe('generated TypeScript syntax', () => {
  it('emits route code without syntax diagnostics', () => {
    expectTranspiles(generateRoutes(SyntaxContract));
  });

  it('emits SDK code without syntax diagnostics', () => {
    expectTranspiles(generateSDK(SyntaxContract));
  });

  it('emits route integration tests without syntax diagnostics', () => {
    const output = generateTests(SyntaxContract);

    expect(output).toContain('app.request');
    expect(output).toContain('createMockDb');
    expectTranspiles(output);
  });
});
