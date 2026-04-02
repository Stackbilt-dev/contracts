/**
 * Client SDK Generator
 *
 * Reads a contract definition and emits a typed fetch client with:
 * - Method per operation
 * - Input types from operation.input
 * - Return types from operation.output
 * - Base URL configuration
 *
 * Output is a self-contained TypeScript module.
 */

import type { ContractDefinition } from '../core/define.js';
import { toSnakeCase } from '../introspect/zod-walker.js';

export interface SDKGeneratorOptions {
  /** Import path for the contract definition */
  contractImport?: string;
  /** Class name override */
  className?: string;
}

/**
 * Generate a typed client SDK from a contract definition.
 */
export function generateSDK(
  contract: ContractDefinition,
  options: SDKGeneratorOptions = {},
): string {
  const {
    contractImport = `./${toSnakeCase(contract.name)}.contract`,
    className = `${contract.name}Client`,
  } = options;

  const api = contract.surfaces.api;
  if (!api) return `// ${contract.name}: no API surface defined\n`;

  const lines: string[] = [];

  // Header
  lines.push(`/**`);
  lines.push(` * Generated SDK for ${contract.name} contract v${contract.version}`);
  lines.push(` * ${contract.description}`);
  lines.push(` */`);
  lines.push('');
  lines.push(`import { z } from 'zod';`);
  lines.push(`import { ${contract.name}Contract } from '${contractImport}';`);
  lines.push('');

  // Infer types from contract schema
  lines.push(`type ${contract.name} = z.infer<typeof ${contract.name}Contract.schema>;`);
  lines.push('');

  // Client class
  lines.push(`export class ${className} {`);
  lines.push(`  constructor(`);
  lines.push(`    private baseUrl: string,`);
  lines.push(`    private headers: Record<string, string> = {},`);
  lines.push(`  ) {}`);
  lines.push('');

  // Helper
  lines.push(`  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {`);
  lines.push(`    const url = \`\${this.baseUrl}${api.basePath}\${path}\`;`);
  lines.push(`    const res = await fetch(url, {`);
  lines.push(`      method,`);
  lines.push(`      headers: { 'Content-Type': 'application/json', ...this.headers },`);
  lines.push(`      body: body ? JSON.stringify(body) : undefined,`);
  lines.push(`    });`);
  lines.push(`    if (!res.ok) {`);
  lines.push(`      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));`);
  lines.push(`      throw new Error((err as { error?: { message?: string } }).error?.message ?? \`HTTP \${res.status}\`);`);
  lines.push(`    }`);
  lines.push(`    return res.json() as Promise<T>;`);
  lines.push(`  }`);
  lines.push('');

  // Methods from operations
  for (const [opName, routeDef] of Object.entries(api.routes)) {
    const operation = contract.operations[opName];
    const method = routeDef.method.toUpperCase();
    const path = routeDef.path;
    const hasPathParam = path.includes(':id');
    const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';

    // Build method signature
    const params: string[] = [];
    if (hasPathParam) {
      params.push('id: string');
    }
    if (hasBody && operation) {
      params.push(`input: z.infer<typeof ${contract.name}Contract.operations.${opName}.input>`);
    }

    const returnType = operation?.output === 'self' ? contract.name : 'unknown';
    const resolvedPath = hasPathParam ? `\`${path.replace(':id', '${id}')}\`` : `'${path}'`;

    lines.push(`  async ${opName}(${params.join(', ')}): Promise<${returnType}> {`);
    lines.push(`    return this.request('${method}', ${resolvedPath}${hasBody ? ', input' : ''});`);
    lines.push(`  }`);
    lines.push('');
  }

  lines.push(`}`);

  return lines.join('\n');
}
