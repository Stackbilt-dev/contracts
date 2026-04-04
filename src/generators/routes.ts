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

import type { ContractDefinition, ContractOperation, AuthRequirement } from '../core/define.js';
import { extractColumns, toSnakeCase } from '../introspect/zod-walker.js';

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

  // Resolve DB table name
  const tableName = contract.surfaces.db?.table ?? toSnakeCase(contract.name) + 's';

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
      const mw = generateAuthMiddleware(auth);
      if (mw) middlewares.push(mw);
    }

    const middlewareStr = middlewares.length > 0
      ? middlewares.join(', ') + ', '
      : '';

    lines.push(`${toSnakeCase(contract.name)}Routes.${method}('${path}', ${middlewareStr}async (c) => {`);
    lines.push(`  try {`);

    // Determine handler type and emit body
    const hasId = path.includes(':id');
    const isTransition = !!(operation?.transition);

    if (isTransition && operation) {
      // State transition handler
      emitTransitionHandler(lines, contract, routeName, operation, tableName, contractVar, method);
    } else if (method === 'delete' && hasId) {
      emitDeleteHandler(lines, tableName, contract.name);
    } else if (method === 'get' && hasId) {
      emitGetHandler(lines, tableName, contract.name);
    } else if (method === 'get' && !hasId) {
      emitListHandler(lines, tableName);
    } else if (method === 'post' || method === 'put' || method === 'patch') {
      if (hasId && (method === 'put' || method === 'patch')) {
        emitUpdateHandler(lines, operation, tableName, contractVar, routeName);
      } else {
        emitCreateHandler(lines, operation, tableName, contractVar, routeName);
      }
    } else {
      // Fallback for unrecognized patterns
      lines.push(`    return c.json({ data: { ok: true } });`);
    }

    // Close try/catch
    lines.push(`  } catch (err) {`);
    lines.push(`    return c.json({ error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Unknown error' } }, 500);`);
    lines.push(`  }`);
    lines.push(`});`);
    lines.push('');
  }

  lines.push(`export { ${toSnakeCase(contract.name)}Routes };`);

  return lines.join('\n');
}

// ── Handler emitters ────────────────────────────────────────────────────────

function emitCreateHandler(
  lines: string[],
  operation: ContractOperation | undefined,
  tableName: string,
  contractVar: string,
  routeName: string,
): void {
  // Body validation
  lines.push(`    const body = await c.req.json();`);
  if (operation) {
    lines.push(`    const parsed = ${contractVar}.operations.${routeName}.input.safeParse(body);`);
    lines.push(`    if (!parsed.success) {`);
    lines.push(`      return c.json({ error: { code: 'INVALID_INPUT', message: parsed.error.message } }, 400);`);
    lines.push(`    }`);
    lines.push('');
    // Extract columns from input schema
    lines.push(`    const db = c.env.DB;`);
    lines.push(`    const id = crypto.randomUUID();`);
    if (operation.input) {
      const cols = extractColumns(operation.input);
      const colNames = ['id', ...cols.map(c => c.name)];
      const placeholders = colNames.map(() => '?').join(', ');
      const bindValues = cols.map(c => `parsed.data.${snakeToCamel(c.name)}`).join(', ');
      lines.push(`    await db.prepare(\`INSERT INTO ${tableName} (${colNames.join(', ')}) VALUES (${placeholders})\`).bind(id, ${bindValues}).run();`);
    } else {
      lines.push(`    await db.prepare(\`INSERT INTO ${tableName} (id) VALUES (?)\`).bind(id).run();`);
    }
    lines.push(`    return c.json({ data: { id, ...parsed.data } }, 201);`);
  } else {
    lines.push(`    const db = c.env.DB;`);
    lines.push(`    const id = crypto.randomUUID();`);
    lines.push(`    await db.prepare(\`INSERT INTO ${tableName} (id) VALUES (?)\`).bind(id).run();`);
    lines.push(`    return c.json({ data: { id, ...body } }, 201);`);
  }
}

function emitGetHandler(
  lines: string[],
  tableName: string,
  contractName: string,
): void {
  lines.push(`    const id = c.req.param('id');`);
  lines.push(`    const db = c.env.DB;`);
  lines.push(`    const row = await db.prepare(\`SELECT * FROM ${tableName} WHERE id = ?\`).bind(id).first();`);
  lines.push(`    if (!row) return c.json({ error: { code: 'NOT_FOUND', message: '${contractName} not found' } }, 404);`);
  lines.push(`    return c.json({ data: row });`);
}

function emitListHandler(
  lines: string[],
  tableName: string,
): void {
  lines.push(`    const db = c.env.DB;`);
  lines.push(`    const { results } = await db.prepare(\`SELECT * FROM ${tableName} LIMIT 100\`).all();`);
  lines.push(`    return c.json({ data: results });`);
}

function emitUpdateHandler(
  lines: string[],
  operation: ContractOperation | undefined,
  tableName: string,
  contractVar: string,
  routeName: string,
): void {
  lines.push(`    const id = c.req.param('id');`);
  lines.push(`    const body = await c.req.json();`);
  if (operation) {
    lines.push(`    const parsed = ${contractVar}.operations.${routeName}.input.safeParse(body);`);
    lines.push(`    if (!parsed.success) {`);
    lines.push(`      return c.json({ error: { code: 'INVALID_INPUT', message: parsed.error.message } }, 400);`);
    lines.push(`    }`);
    lines.push('');
    lines.push(`    const db = c.env.DB;`);
    const cols = operation.input ? extractColumns(operation.input) : [];
    if (cols.length > 0) {
      const setClauses = cols.map(c => `${c.name} = ?`).join(', ');
      const bindValues = cols.map(c => `parsed.data.${snakeToCamel(c.name)}`).join(', ');
      lines.push(`    await db.prepare(\`UPDATE ${tableName} SET ${setClauses} WHERE id = ?\`).bind(${bindValues}, id).run();`);
    } else {
      lines.push(`    await db.prepare(\`UPDATE ${tableName} SET id = id WHERE id = ?\`).bind(id).run();`);
    }
    lines.push(`    return c.json({ data: { id, ...parsed.data } });`);
  } else {
    lines.push(`    const db = c.env.DB;`);
    lines.push(`    return c.json({ data: { id, ...body } });`);
  }
}

function emitDeleteHandler(
  lines: string[],
  tableName: string,
  contractName: string,
): void {
  lines.push(`    const id = c.req.param('id');`);
  lines.push(`    const db = c.env.DB;`);
  lines.push(`    await db.prepare(\`DELETE FROM ${tableName} WHERE id = ?\`).bind(id).run();`);
  lines.push(`    return c.json({ data: { id } });`);
}

function emitTransitionHandler(
  lines: string[],
  contract: ContractDefinition,
  routeName: string,
  operation: ContractOperation,
  tableName: string,
  contractVar: string,
  method: string,
): void {
  const transition = operation.transition!;
  const stateField = contract.states?.field ?? 'status';
  const stateCol = toSnakeCase(stateField);
  const fromStates = Array.isArray(transition.from) ? transition.from : [transition.from];
  const toState = transition.to;

  // Body validation for non-GET/DELETE methods
  if (method !== 'get' && method !== 'delete') {
    lines.push(`    const body = await c.req.json();`);
    lines.push(`    const parsed = ${contractVar}.operations.${routeName}.input.safeParse(body);`);
    lines.push(`    if (!parsed.success) {`);
    lines.push(`      return c.json({ error: { code: 'INVALID_INPUT', message: parsed.error.message } }, 400);`);
    lines.push(`    }`);
    lines.push('');
  }

  lines.push(`    const id = c.req.param('id');`);
  lines.push(`    const db = c.env.DB;`);
  lines.push(`    const row = await db.prepare(\`SELECT * FROM ${tableName} WHERE id = ?\`).bind(id).first();`);
  lines.push(`    if (!row) return c.json({ error: { code: 'NOT_FOUND', message: '${contract.name} not found' } }, 404);`);

  // State guard
  if (fromStates.length === 1) {
    lines.push(`    if (row.${stateCol} !== '${fromStates[0]}') {`);
  } else {
    const fromCheck = fromStates.map(s => `'${s}'`).join(', ');
    lines.push(`    if (![${fromCheck}].includes(row.${stateCol} as string)) {`);
  }
  lines.push(`      return c.json({ error: { code: 'INVALID_STATE', message: \`Cannot ${routeName} from \${row.${stateCol}}\` } }, 409);`);
  lines.push(`    }`);

  lines.push(`    await db.prepare(\`UPDATE ${tableName} SET ${stateCol} = ? WHERE id = ?\`).bind('${toState}', id).run();`);
  lines.push(`    return c.json({ data: { ...row, ${stateCol}: '${toState}' } });`);
}

/** Convert snake_case to camelCase for accessing parsed data fields */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
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
