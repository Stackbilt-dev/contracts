/**
 * OpenAPI 3.1 Spec Generator
 *
 * Reads a contract definition and emits an OpenAPI specification with:
 * - Paths from surfaces.api.routes
 * - Request bodies from operation.input
 * - Response schemas from operation.output
 * - Security requirements from authority
 * - Component schemas from contract.schema
 */

import type { ContractDefinition, AuthRequirement } from '../core/define.js';
import { extractColumns, extractEnums, toSnakeCase } from '../introspect/zod-walker.js';

export interface OpenAPIGeneratorOptions {
  /** API title override */
  title?: string;
  /** API version override */
  version?: string;
  /** Server URL */
  serverUrl?: string;
}

interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers?: Array<{ url: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

/**
 * Generate an OpenAPI 3.1 specification from a contract definition.
 */
export function generateOpenAPI(
  contract: ContractDefinition,
  options: OpenAPIGeneratorOptions = {},
): OpenAPISpec {
  const api = contract.surfaces.api;
  if (!api) {
    return {
      openapi: '3.1.0',
      info: { title: contract.name, version: contract.version, description: contract.description },
      paths: {},
      components: { schemas: {} },
    };
  }

  const paths: Record<string, Record<string, unknown>> = {};
  const hasAuth = Object.values(contract.authority).some(a => a.requires !== 'public');

  // Build paths
  for (const [opName, routeDef] of Object.entries(api.routes)) {
    const method = routeDef.method.toLowerCase();
    // Convert :id to {id} for OpenAPI
    const path = `${api.basePath}${routeDef.path}`.replace(/:(\w+)/g, '{$1}');
    const operation = contract.operations[opName];
    const auth = contract.authority[opName];

    if (!paths[path]) paths[path] = {};

    const opSpec: Record<string, unknown> = {
      operationId: `${toSnakeCase(contract.name)}_${opName}`,
      summary: `${opName} ${contract.name}`,
      tags: [contract.name],
    };

    // Parameters (path params)
    const paramMatches = routeDef.path.match(/:(\w+)/g);
    if (paramMatches) {
      opSpec.parameters = paramMatches.map(p => ({
        name: p.slice(1),
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
    }

    // Request body for POST/PUT/PATCH
    if (operation && (method === 'post' || method === 'put' || method === 'patch')) {
      opSpec.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${contract.name}${capitalize(opName)}Input` },
          },
        },
      };
    }

    // Responses
    opSpec.responses = {
      '200': {
        description: 'Success',
        content: {
          'application/json': {
            schema: operation?.output === 'self'
              ? { $ref: `#/components/schemas/${contract.name}` }
              : { type: 'object' },
          },
        },
      },
      ...(auth?.requires !== 'public' ? { '401': { description: 'Unauthorized' } } : {}),
      '400': { description: 'Invalid input' },
    };

    // Security
    if (auth && auth.requires !== 'public') {
      opSpec.security = [{ bearerAuth: [] }];
    }

    paths[path][method] = opSpec;
  }

  // Build component schemas
  const schemas: Record<string, unknown> = {};

  // Main entity schema
  const columns = extractColumns(contract.schema);
  const enums = extractEnums(contract.schema);

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const col of columns) {
    const prop: Record<string, unknown> = { type: zodSqlToOpenAPI(col.sqlType) };
    if (enums[col.name]) {
      prop.enum = enums[col.name];
    }
    if (col.nullable) {
      prop.nullable = true;
    }
    properties[camelCase(col.name)] = prop;
    if (!col.nullable && col.defaultValue === null) {
      required.push(camelCase(col.name));
    }
  }

  schemas[contract.name] = { type: 'object', properties, required };

  // Operation input schemas
  for (const [opName, op] of Object.entries(contract.operations)) {
    const inputColumns = extractColumns(op.input);
    if (inputColumns.length > 0) {
      const inputProps: Record<string, unknown> = {};
      const inputRequired: string[] = [];
      for (const col of inputColumns) {
        inputProps[camelCase(col.name)] = {
          type: zodSqlToOpenAPI(col.sqlType),
          ...(col.nullable ? { nullable: true } : {}),
        };
        if (!col.nullable && col.defaultValue === null) {
          inputRequired.push(camelCase(col.name));
        }
      }
      schemas[`${contract.name}${capitalize(opName)}Input`] = {
        type: 'object',
        properties: inputProps,
        required: inputRequired,
      };
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.title ?? `${contract.name} API`,
      version: options.version ?? contract.version,
      description: contract.description,
    },
    ...(options.serverUrl ? { servers: [{ url: options.serverUrl }] } : {}),
    paths,
    components: {
      schemas,
      ...(hasAuth
        ? {
            securitySchemes: {
              bearerAuth: { type: 'http', scheme: 'bearer' },
            },
          }
        : {}),
    },
  };
}

function zodSqlToOpenAPI(sqlType: string): string {
  switch (sqlType) {
    case 'INTEGER': return 'integer';
    case 'REAL': return 'number';
    case 'TEXT': return 'string';
    default: return 'string';
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function camelCase(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
