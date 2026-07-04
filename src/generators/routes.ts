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
  /** Whether to include contract event helper imports when operations declare emits */
  includeEventImports?: boolean;
  /** Import path for emitContractEvent */
  eventImport?: string;
  /** Expression resolving the event sink inside a generated Hono handler */
  eventSinkExpression?: string;
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
    includeEventImports = true,
    eventImport = '@stackbilt/contracts',
    eventSinkExpression = `c.get('contractEventSink')`,
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

  const hasDeclaredEvents = Object.values(contract.operations).some(op => (op.emits?.length ?? 0) > 0);
  if (includeEventImports && hasDeclaredEvents) {
    lines.push(`import { emitContractEvent } from '${eventImport}';`);
  }

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
      emitTransitionHandler(lines, contract, routeName, operation, tableName, contractVar, method, eventSinkExpression);
    } else if (method === 'delete' && hasId) {
      emitDeleteHandler(lines, operation, contract.name, routeName, tableName, eventSinkExpression);
    } else if (method === 'get' && hasId) {
      emitGetHandler(lines, contract, operation, routeName, tableName, eventSinkExpression);
    } else if (method === 'get' && !hasId) {
      emitListHandler(lines, contract, operation, routeName, tableName, eventSinkExpression);
    } else if (method === 'post' || method === 'put' || method === 'patch') {
      if (hasId && (method === 'put' || method === 'patch')) {
        emitUpdateHandler(lines, operation, contract.name, routeName, tableName, contractVar, eventSinkExpression);
      } else {
        emitCreateHandler(lines, operation, contract.name, routeName, tableName, contractVar, eventSinkExpression);
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
  contractName: string,
  routeName: string,
  tableName: string,
  contractVar: string,
  eventSinkExpression: string,
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
    emitEventCalls(lines, operation, contractName, routeName, 'id', '{ id, ...parsed.data }', eventSinkExpression);
    lines.push(`    return c.json({ data: { id, ...parsed.data } }, 201);`);
  } else {
    lines.push(`    const db = c.env.DB;`);
    lines.push(`    const id = crypto.randomUUID();`);
    lines.push(`    await db.prepare(\`INSERT INTO ${tableName} (id) VALUES (?)\`).bind(id).run();`);
    emitEventCalls(lines, operation, contractName, routeName, 'id', '{ id, ...body }', eventSinkExpression);
    lines.push(`    return c.json({ data: { id, ...body } }, 201);`);
  }
}

function emitGetHandler(
  lines: string[],
  contract: ContractDefinition,
  operation: ContractOperation | undefined,
  routeName: string,
  tableName: string,
  eventSinkExpression: string,
): void {
  const select = buildSelectQuery(contract, tableName);
  lines.push(`    const id = c.req.param('id');`);
  lines.push(`    const db = c.env.DB;`);
  lines.push(`    const row = await db.prepare(\`${select.getByIdSql}\`).bind(id).first();`);
  lines.push(`    if (!row) return c.json({ error: { code: 'NOT_FOUND', message: '${contract.name} not found' } }, 404);`);
  emitEventCalls(lines, operation, contract.name, routeName, 'id', 'row', eventSinkExpression);
  lines.push(`    return c.json({ data: row });`);
}

function emitListHandler(
  lines: string[],
  contract: ContractDefinition,
  operation: ContractOperation | undefined,
  routeName: string,
  tableName: string,
  eventSinkExpression: string,
): void {
  const select = buildSelectQuery(contract, tableName);
  lines.push(`    const db = c.env.DB;`);
  lines.push(`    const { results } = await db.prepare(\`${select.listSql}\`).all();`);
  emitEventCalls(lines, operation, contract.name, routeName, 'undefined', 'results', eventSinkExpression);
  lines.push(`    return c.json({ data: results });`);
}

function emitUpdateHandler(
  lines: string[],
  operation: ContractOperation | undefined,
  contractName: string,
  routeName: string,
  tableName: string,
  contractVar: string,
  eventSinkExpression: string,
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
    emitEventCalls(lines, operation, contractName, routeName, 'id', '{ id, ...parsed.data }', eventSinkExpression);
    lines.push(`    return c.json({ data: { id, ...parsed.data } });`);
  } else {
    lines.push(`    const db = c.env.DB;`);
    emitEventCalls(lines, operation, contractName, routeName, 'id', '{ id, ...body }', eventSinkExpression);
    lines.push(`    return c.json({ data: { id, ...body } });`);
  }
}

function emitDeleteHandler(
  lines: string[],
  operation: ContractOperation | undefined,
  contractName: string,
  routeName: string,
  tableName: string,
  eventSinkExpression: string,
): void {
  lines.push(`    const id = c.req.param('id');`);
  lines.push(`    const db = c.env.DB;`);
  lines.push(`    await db.prepare(\`DELETE FROM ${tableName} WHERE id = ?\`).bind(id).run();`);
  emitEventCalls(lines, operation, contractName, routeName, 'id', '{ id }', eventSinkExpression);
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
  eventSinkExpression: string,
): void {
  const transition = operation.transition!;
  const stateField = contract.states?.field ?? 'status';
  const stateCol = toSnakeCase(stateField);
  // Pure guarded-write operations (contracts#29) omit from/to entirely —
  // they don't transition states.field at all, only guard+write other
  // fields. Don't fake a same-state pseudo-transition to detect this.
  const hasStateTransition = transition.from !== undefined && transition.to !== undefined;
  const fromStates = hasStateTransition
    ? (Array.isArray(transition.from) ? transition.from : [transition.from as string])
    : [];
  const toState = transition.to;
  const hasGuard = !!transition.guard;
  const writesKeys = transition.writes ? Object.keys(transition.writes) : [];

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

  // State guard — only for operations that actually transition states.field
  if (hasStateTransition) {
    if (fromStates.length === 1) {
      lines.push(`    if (row.${stateCol} !== '${fromStates[0]}') {`);
    } else {
      const fromCheck = fromStates.map(s => `'${s}'`).join(', ');
      lines.push(`    if (![${fromCheck}].includes(row.${stateCol} as string)) {`);
    }
    lines.push(`      return c.json({ error: { code: 'INVALID_STATE', message: \`Cannot ${routeName} from \${row.${stateCol}}\` } }, 409);`);
    lines.push(`    }`);
  }

  // Guard: precondition over sibling fields, checked in addition to (or, for
  // a pure guarded-write with no state transition, instead of) the state guard.
  if (hasGuard) {
    lines.push('');
    lines.push(`    const guardResult = ${contractVar}.operations.${routeName}.transition!.guard!(row);`);
    lines.push(`    if (guardResult !== true) {`);
    lines.push(`      return c.json({ error: { code: 'GUARD_FAILED', message: typeof guardResult === 'string' ? guardResult : \`Guard rejected ${routeName}\` } }, 409);`);
    lines.push(`    }`);
  }

  // Resolve additional field writes (literal or a function of the row) once,
  // so the resolved value is reused for both the UPDATE bind and the response.
  for (const key of writesKeys) {
    lines.push('');
    lines.push(`    const ${key}Writer = ${contractVar}.operations.${routeName}.transition!.writes!['${key}'];`);
    lines.push(`    const ${key}Value = typeof ${key}Writer === 'function' ? (${key}Writer as (e: unknown) => unknown)(row) : ${key}Writer;`);
  }

  const setClauses: string[] = [];
  const bindExprs: string[] = [];
  if (hasStateTransition) {
    setClauses.push(`${stateCol} = ?`);
    bindExprs.push(`'${toState}'`);
  }
  for (const key of writesKeys) {
    setClauses.push(`${toSnakeCase(key)} = ?`);
    bindExprs.push(`${key}Value`);
  }

  lines.push('');
  lines.push(`    await db.prepare(\`UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = ?\`).bind(${bindExprs.join(', ')}, id).run();`);

  const responseFields = [
    '...row',
    ...(hasStateTransition ? [`${stateCol}: '${toState}'`] : []),
    ...writesKeys.map(key => `${toSnakeCase(key)}: ${key}Value`),
  ];
  const responseExpr = `{ ${responseFields.join(', ')} }`;

  emitEventCalls(lines, operation, contract.name, routeName, 'id', responseExpr, eventSinkExpression);
  lines.push(`    return c.json({ data: ${responseExpr} });`);
}

function emitEventCalls(
  lines: string[],
  operation: ContractOperation | undefined,
  contractName: string,
  routeName: string,
  entityIdExpr: string,
  payloadExpr: string,
  eventSinkExpression: string,
): void {
  if (!operation?.emits?.length) return;

  for (const eventName of operation.emits) {
    lines.push(`    await emitContractEvent(${eventSinkExpression}, {`);
    lines.push(`      contract: '${contractName}',`);
    lines.push(`      operation: '${routeName}',`);
    lines.push(`      event: '${eventName}',`);
    lines.push(`      entityId: ${entityIdExpr},`);
    lines.push(`      payload: ${payloadExpr},`);
    lines.push(`    });`);
  }
}

function buildSelectQuery(contract: ContractDefinition, tableName: string): { getByIdSql: string; listSql: string } {
  const refs = extractColumns(contract.schema).filter(col => col.isRef && col.refTable && col.refField);
  if (refs.length === 0) {
    return {
      getByIdSql: `SELECT * FROM ${tableName} WHERE id = ?`,
      listSql: `SELECT * FROM ${tableName} LIMIT 100`,
    };
  }

  const joins = refs.map(col => {
    const alias = `${col.name}_ref`;
    return `LEFT JOIN ${col.refTable} AS ${alias} ON ${tableName}.${col.name} = ${alias}.${col.refField}`;
  }).join(' ');
  const refSelects = refs.map(col => {
    const alias = `${col.name}_ref`;
    return `${alias}.${col.refField} AS ${col.name}_${col.refTable}_${col.refField}`;
  });
  const selectList = [`${tableName}.*`, ...refSelects].join(', ');

  return {
    getByIdSql: `SELECT ${selectList} FROM ${tableName} ${joins} WHERE ${tableName}.id = ?`,
    listSql: `SELECT ${selectList} FROM ${tableName} ${joins} LIMIT 100`,
  };
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
