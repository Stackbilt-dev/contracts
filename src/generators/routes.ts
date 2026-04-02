/**
 * Hono Route Generator
 *
 * Reads a contract definition and emits typed Hono route handlers with:
 * - Route paths from surfaces.api.routes
 * - Input validation from operation.input schemas
 * - Authority middleware from contract.authority
 * - State transition guards from contract.states
 *
 * Output is valid TypeScript importing from hono.
 */

import type { ContractDefinition, AuthRequirement } from '../core/define.js';
import { toSnakeCase } from '../introspect/zod-walker.js';

export interface RouteGeneratorOptions {
  /** Import path for the contract definition */
  contractImport?: string;
  /** Hono app variable name */
  appVar?: string;
  /** Whether to include auth middleware imports */
  includeAuthImports?: boolean;
}

/**
 * Generate Hono route handler code from a contract definition.
 */
export function generateRoutes(
  contract: ContractDefinition,
  options: RouteGeneratorOptions = {},
): string {
  const {
    contractImport = `./${toSnakeCase(contract.name)}.contract`,
    appVar = 'app',
    includeAuthImports = true,
  } = options;

  const api = contract.surfaces.api;
  if (!api) return `// ${contract.name}: no API surface defined\n`;

  const lines: string[] = [];
  const contractVar = `${contract.name}Contract`;

  // Header
  lines.push(`/**`);
  lines.push(` * Generated routes for ${contract.name} contract v${contract.version}`);
  lines.push(` * ${contract.description}`);
  lines.push(` */`);
  lines.push('');

  // Imports
  lines.push(`import { Hono } from 'hono';`);
  lines.push(`import { ${contractVar} } from '${contractImport}';`);

  if (includeAuthImports) {
    const authTypes = new Set<string>();
    for (const auth of Object.values(contract.authority)) {
      if (auth.requires === 'authenticated' || auth.requires === 'owner') {
        authTypes.add('requireAuth');
      }
      if (auth.requires === 'owner') {
        authTypes.add('requireOwner');
      }
      if (auth.requires === 'role') {
        authTypes.add('requireRole');
      }
    }
    if (authTypes.size > 0) {
      lines.push(`import { ${[...authTypes].join(', ')} } from '../middleware/auth';`);
    }
  }

  lines.push('');
  lines.push(`const ${toSnakeCase(contract.name)}Routes = new Hono<{ Bindings: Env }>();`);
  lines.push('');

  // Generate route handlers
  for (const [routeName, routeDef] of Object.entries(api.routes)) {
    const method = routeDef.method.toLowerCase();
    const path = routeDef.path;
    const operation = contract.operations[routeName];
    const auth = contract.authority[routeName];

    lines.push(`// ${routeName}`);

    // Build middleware chain
    const middlewares: string[] = [];
    if (auth) {
      middlewares.push(generateAuthMiddleware(auth));
    }

    const middlewareStr = middlewares.length > 0
      ? middlewares.join(', ') + ', '
      : '';

    lines.push(`${toSnakeCase(contract.name)}Routes.${method}('${path}', ${middlewareStr}async (c) => {`);

    // Input validation for operations with input schemas
    if (operation) {
      if (method === 'get' || method === 'delete') {
        // Path params
        if (path.includes(':id')) {
          lines.push(`  const id = c.req.param('id');`);
        }
      } else {
        // Body validation
        lines.push(`  const body = await c.req.json();`);
        lines.push(`  const parsed = ${contractVar}.operations.${routeName}.input.safeParse(body);`);
        lines.push(`  if (!parsed.success) {`);
        lines.push(`    return c.json({ error: { code: 'INVALID_INPUT', message: parsed.error.message } }, 400);`);
        lines.push(`  }`);
        lines.push('');
      }

      // State transition guard
      if (operation.transition) {
        const from = Array.isArray(operation.transition.from)
          ? operation.transition.from
          : [operation.transition.from];
        const fromStr = from.map(s => `'${s}'`).join(', ');
        lines.push(`  // State guard: requires status in [${fromStr}]`);
        lines.push(`  // TODO: fetch entity, verify current state`);
        lines.push('');
      }
    }

    lines.push(`  // TODO: implement ${routeName} handler`);
    lines.push(`  return c.json({ status: 'ok' });`);
    lines.push(`});`);
    lines.push('');
  }

  lines.push(`export { ${toSnakeCase(contract.name)}Routes };`);

  return lines.join('\n');
}

function generateAuthMiddleware(auth: AuthRequirement): string {
  switch (auth.requires) {
    case 'public':
      return '';
    case 'authenticated':
      return 'requireAuth()';
    case 'owner':
      return `requireOwner('${auth.ownerField}')`;
    case 'role':
      return `requireRole(${JSON.stringify(auth.roles)})`;
  }
}
