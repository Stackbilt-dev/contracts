/**
 * Scaffold Response Contract Tests
 *
 * Validates the canonical response shape for TarotScript's scaffold-cast spread.
 * Covers schema validation, rejection, FileRole enum, contract definition, and
 * generator compatibility.
 */

import { describe, it, expect } from 'vitest';
import {
  ScaffoldResponseContract,
  ScaffoldFile,
  GovernanceDocs,
  PromptContext,
  MaterializerResult,
  FileRole,
  SchemaVersion,
} from '../src/scaffold-response/index.js';
import { generateSDK, generateOpenAPI } from '../src/generators/index.js';

// ── Realistic test fixtures ────────────────────────────────────────────────

const validGovernance: ReturnType<typeof GovernanceDocs.parse> = {
  threat_model: '## Threat Model\n\n### SSRF via fetch\n- **OWASP**: A10:2021\n- **Likelihood**: Medium\n- **Mitigation**: Validate URL allowlist in wrangler.toml bindings\n\n### Secret Exfiltration\n- **OWASP**: A01:2021\n- **Mitigation**: All secrets via env bindings, never hardcoded',
  adr: '## ADR-001: Cloudflare Workers over Lambda\n\n**Status**: Accepted\n**Context**: Sub-50ms cold starts required for interactive scaffold preview.\n**Decision**: Deploy on CF Workers with Hono router.\n**Consequences**: No Node.js APIs, V8 isolate constraints, 128MB memory cap.',
  test_plan: '## Test Plan\n\n### Unit\n- Vitest for handler logic, mocked KV/D1 bindings\n### Integration\n- Miniflare-based tests for wrangler.toml binding validation\n### E2E\n- Playwright smoke against deployed preview URL',
};

const validScaffoldFiles: ReturnType<typeof ScaffoldFile.parse>[] = [
  { path: 'wrangler.toml', content: 'name = "my-worker"\nmain = "src/index.ts"\ncompatibility_date = "2024-09-23"\n\n[vars]\nENVIRONMENT = "production"', role: 'config' },
  { path: 'src/index.ts', content: 'import { Hono } from "hono";\n\nconst app = new Hono();\napp.get("/", (c) => c.json({ ok: true }));\nexport default app;', role: 'scaffold' },
  { path: 'package.json', content: '{ "name": "my-worker", "scripts": { "dev": "wrangler dev", "deploy": "wrangler deploy" } }', role: 'config' },
  { path: '.ai/threat-model.md', content: validGovernance.threat_model, role: 'governance' },
  { path: '.ai/adr-001.md', content: validGovernance.adr, role: 'governance' },
  { path: 'tests/handler.test.ts', content: 'import { describe, it, expect } from "vitest";\ndescribe("handler", () => { it("returns 200", () => { expect(true).toBe(true); }); });', role: 'test' },
  { path: 'docs/architecture.md', content: '# Architecture\n\nCloudflare Workers with Hono router, KV for state, D1 for persistence.', role: 'doc' },
];

const validPromptContext: ReturnType<typeof PromptContext.parse> = {
  intention: 'build a real-time notification service',
  pattern: 'durable-objects-websocket',
  meta: {
    project_type: 'api',
    complexity: 'moderate',
    confidence: 'high',
    seed: 42,
  },
  requirement: {
    name: 'WebSocket notification hub',
    priority: 'P1',
    effort: '3 days',
    acceptance: 'Clients receive push events within 200ms of server emit',
  },
  interface: {
    name: 'NotificationDashboard',
    layout: 'split-panel',
    components: 'ConnectionStatus, EventLog, SubscriptionManager',
  },
  threat: {
    name: 'WebSocket hijacking',
    owasp: 'A07:2021',
    likelihood: 'medium',
    impact: 'high',
    mitigation: 'Origin validation + auth token on upgrade',
    detection: 'Connection rate monitoring via DO alarm',
    response_time: '< 5 minutes',
  },
  runtime: {
    name: 'Cloudflare Workers + Durable Objects',
    tier: 'workers-paid',
    traits: 'websocket, stateful, global-routing',
  },
  test_plan: {
    name: 'DO WebSocket integration',
    framework: 'vitest + miniflare',
    ci_stage: 'integration',
    coverage: '80% branch',
    setup: 'Miniflare with DO bindings, mock WebSocket client',
    assertion_style: 'expect().toBe / .toContain',
  },
  first_task: {
    name: 'Implement connection upgrade handler',
    estimate: '4h',
    complexity: 'moderate',
    deliverable: 'src/do/notification-hub.ts passing WebSocket upgrade test',
    adr: 'ADR-001: Durable Objects for WebSocket state over KV polling',
  },
  governance: validGovernance,
  files: validScaffoldFiles,
};

const validMaterializerResult: ReturnType<typeof MaterializerResult.parse> = {
  files: validScaffoldFiles,
  nextSteps: [
    'Run `npm install` to install dependencies',
    'Run `npx wrangler dev` to start local development',
    'Configure KV namespace in wrangler.toml for production',
    'Deploy with `npx wrangler deploy`',
  ],
  promptContext: validPromptContext,
};

const validContractPayload = {
  schema_version: 1 as const,
  files: validScaffoldFiles,
  nextSteps: validMaterializerResult.nextSteps,
  promptContext: validPromptContext,
  governance: validGovernance,
};

// ── 1. Schema Validation ───────────────────────────────────────────────────

describe('Schema Validation', () => {
  it('parses a valid ScaffoldFile', () => {
    const result = ScaffoldFile.safeParse({
      path: 'wrangler.toml',
      content: 'name = "my-worker"',
      role: 'config',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.path).toBe('wrangler.toml');
      expect(result.data.role).toBe('config');
    }
  });

  it('parses all scaffold files with realistic content', () => {
    for (const file of validScaffoldFiles) {
      const result = ScaffoldFile.safeParse(file);
      expect(result.success).toBe(true);
    }
  });

  it('parses valid GovernanceDocs', () => {
    const result = GovernanceDocs.safeParse(validGovernance);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.threat_model).toContain('Threat Model');
      expect(result.data.adr).toContain('ADR-001');
      expect(result.data.test_plan).toContain('Test Plan');
    }
  });

  it('parses valid PromptContext with all nested domains', () => {
    const result = PromptContext.safeParse(validPromptContext);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intention).toBe('build a real-time notification service');
      expect(result.data.pattern).toBe('durable-objects-websocket');
      expect(result.data.meta.seed).toBe(42);
      expect(result.data.requirement.priority).toBe('P1');
      expect(result.data.threat.owasp).toBe('A07:2021');
      expect(result.data.runtime.tier).toBe('workers-paid');
      expect(result.data.test_plan.framework).toBe('vitest + miniflare');
      expect(result.data.first_task.estimate).toBe('4h');
      expect(result.data.governance.adr).toContain('ADR-001');
      expect(result.data.files).toHaveLength(validScaffoldFiles.length);
    }
  });

  it('parses valid MaterializerResult', () => {
    const result = MaterializerResult.safeParse(validMaterializerResult);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files).toHaveLength(validScaffoldFiles.length);
      expect(result.data.nextSteps).toHaveLength(4);
      expect(result.data.promptContext.intention).toBe('build a real-time notification service');
    }
  });

  it('parses the full contract schema payload', () => {
    const result = ScaffoldResponseContract.schema.safeParse(validContractPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema_version).toBe(1);
      expect(result.data.files).toHaveLength(validScaffoldFiles.length);
      expect(result.data.governance.threat_model).toContain('SSRF');
    }
  });

  it('parses SchemaVersion literal', () => {
    expect(SchemaVersion.safeParse(1).success).toBe(true);
  });
});

// ── 2. Rejection ───────────────────────────────────────────────────────────

describe('Rejection', () => {
  it('rejects ScaffoldFile missing path', () => {
    const result = ScaffoldFile.safeParse({ content: 'x', role: 'config' });
    expect(result.success).toBe(false);
  });

  it('rejects ScaffoldFile missing content', () => {
    const result = ScaffoldFile.safeParse({ path: 'x.ts', role: 'scaffold' });
    expect(result.success).toBe(false);
  });

  it('rejects ScaffoldFile missing role', () => {
    const result = ScaffoldFile.safeParse({ path: 'x.ts', content: 'y' });
    expect(result.success).toBe(false);
  });

  it('rejects ScaffoldFile with invalid role value', () => {
    const result = ScaffoldFile.safeParse({ path: 'x.ts', content: 'y', role: 'template' });
    expect(result.success).toBe(false);
  });

  it('rejects GovernanceDocs missing threat_model', () => {
    const result = GovernanceDocs.safeParse({ adr: 'x', test_plan: 'y' });
    expect(result.success).toBe(false);
  });

  it('rejects GovernanceDocs missing adr', () => {
    const result = GovernanceDocs.safeParse({ threat_model: 'x', test_plan: 'y' });
    expect(result.success).toBe(false);
  });

  it('rejects GovernanceDocs missing test_plan', () => {
    const result = GovernanceDocs.safeParse({ threat_model: 'x', adr: 'y' });
    expect(result.success).toBe(false);
  });

  it('rejects PromptContext missing intention', () => {
    const { intention, ...rest } = validPromptContext;
    const result = PromptContext.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects PromptContext missing meta', () => {
    const { meta, ...rest } = validPromptContext;
    const result = PromptContext.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects PromptContext with meta.seed as string', () => {
    const bad = { ...validPromptContext, meta: { ...validPromptContext.meta, seed: 'not-a-number' } };
    const result = PromptContext.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects MaterializerResult missing files', () => {
    const { files, ...rest } = validMaterializerResult;
    const result = MaterializerResult.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects MaterializerResult missing nextSteps', () => {
    const { nextSteps, ...rest } = validMaterializerResult;
    const result = MaterializerResult.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects MaterializerResult missing promptContext', () => {
    const { promptContext, ...rest } = validMaterializerResult;
    const result = MaterializerResult.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects wrong schema_version', () => {
    const bad = { ...validContractPayload, schema_version: 2 };
    const result = ScaffoldResponseContract.schema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects schema_version as string', () => {
    const bad = { ...validContractPayload, schema_version: '1' };
    const result = ScaffoldResponseContract.schema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects contract payload missing governance', () => {
    const { governance, ...rest } = validContractPayload;
    const result = ScaffoldResponseContract.schema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects contract payload missing files', () => {
    const { files, ...rest } = validContractPayload;
    const result = ScaffoldResponseContract.schema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects completely empty object', () => {
    expect(ScaffoldResponseContract.schema.safeParse({}).success).toBe(false);
  });

  it('rejects null', () => {
    expect(ScaffoldResponseContract.schema.safeParse(null).success).toBe(false);
  });

  it('rejects undefined', () => {
    expect(ScaffoldResponseContract.schema.safeParse(undefined).success).toBe(false);
  });
});

// ── 3. FileRole Enum ───────────────────────────────────────────────────────

describe('FileRole Enum', () => {
  const validRoles = ['config', 'scaffold', 'governance', 'test', 'doc'] as const;

  it.each(validRoles)('accepts "%s"', (role) => {
    const result = FileRole.safeParse(role);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(role);
    }
  });

  it('accepts all 5 roles and no more', () => {
    expect(FileRole.options).toHaveLength(5);
    expect(FileRole.options).toEqual(expect.arrayContaining(validRoles));
  });

  const invalidRoles = ['template', 'source', 'binary', 'asset', '', 'CONFIG', 'Scaffold', 123, null, undefined];

  it.each(invalidRoles)('rejects invalid role: %s', (role) => {
    expect(FileRole.safeParse(role).success).toBe(false);
  });

  it('each valid role works inside a ScaffoldFile', () => {
    for (const role of validRoles) {
      const result = ScaffoldFile.safeParse({ path: `file.${role}`, content: 'x', role });
      expect(result.success).toBe(true);
    }
  });
});

// ── 4. Contract Definition ─────────────────────────────────────────────────

describe('Contract Definition', () => {
  it('has correct name', () => {
    expect(ScaffoldResponseContract.name).toBe('ScaffoldResponse');
  });

  it('has correct version', () => {
    expect(ScaffoldResponseContract.version).toBe('1.0.0');
  });

  it('has a description', () => {
    expect(ScaffoldResponseContract.description).toBeTruthy();
    expect(typeof ScaffoldResponseContract.description).toBe('string');
  });

  describe('surfaces', () => {
    it('defines an api surface', () => {
      expect(ScaffoldResponseContract.surfaces.api).toBeDefined();
    });

    it('has empty basePath', () => {
      expect(ScaffoldResponseContract.surfaces.api!.basePath).toBe('');
    });

    it('defines POST /run route', () => {
      const run = ScaffoldResponseContract.surfaces.api!.routes.run;
      expect(run).toBeDefined();
      expect(run.method).toBe('POST');
      expect(run.path).toBe('/run');
    });

    it('defines GET /receipt/:hash route', () => {
      const receipt = ScaffoldResponseContract.surfaces.api!.routes.receipt;
      expect(receipt).toBeDefined();
      expect(receipt.method).toBe('GET');
      expect(receipt.path).toBe('/receipt/:hash');
    });

    it('has exactly 2 routes', () => {
      expect(Object.keys(ScaffoldResponseContract.surfaces.api!.routes)).toHaveLength(2);
    });
  });

  describe('operations', () => {
    it('defines run operation', () => {
      expect(ScaffoldResponseContract.operations.run).toBeDefined();
    });

    it('run operation output is self', () => {
      expect(ScaffoldResponseContract.operations.run.output).toBe('self');
    });

    it('run operation input requires scaffold-cast spreadType', () => {
      const validInput = {
        spreadType: 'scaffold-cast',
        querent: { intention: 'build a todo app' },
      };
      const result = ScaffoldResponseContract.operations.run.input.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('run operation input rejects wrong spreadType', () => {
      const badInput = {
        spreadType: 'three-card',
        querent: { intention: 'build a todo app' },
      };
      const result = ScaffoldResponseContract.operations.run.input.safeParse(badInput);
      expect(result.success).toBe(false);
    });

    it('run operation input accepts optional fields', () => {
      const fullInput = {
        spreadType: 'scaffold-cast',
        querent: {
          id: 'user-123',
          intention: 'build a notification service',
          state: { complexity: 'moderate', project_type: 'api', pattern: 'durable-objects-websocket' },
        },
        responseMode: 'structured-only',
        inscribe: true,
        seed: 42,
      };
      const result = ScaffoldResponseContract.operations.run.input.safeParse(fullInput);
      expect(result.success).toBe(true);
    });

    it('run operation input rejects invalid responseMode', () => {
      const badInput = {
        spreadType: 'scaffold-cast',
        querent: { intention: 'test' },
        responseMode: 'verbose',
      };
      const result = ScaffoldResponseContract.operations.run.input.safeParse(badInput);
      expect(result.success).toBe(false);
    });

    it('defines receipt operation', () => {
      expect(ScaffoldResponseContract.operations.receipt).toBeDefined();
    });

    it('receipt operation output is self', () => {
      expect(ScaffoldResponseContract.operations.receipt.output).toBe('self');
    });

    it('receipt operation input requires hash', () => {
      const validInput = { hash: 'abc123def456' };
      const result = ScaffoldResponseContract.operations.receipt.input.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('receipt operation input rejects missing hash', () => {
      const result = ScaffoldResponseContract.operations.receipt.input.safeParse({});
      expect(result.success).toBe(false);
    });

    it('has exactly 2 operations', () => {
      expect(Object.keys(ScaffoldResponseContract.operations)).toHaveLength(2);
    });
  });

  describe('authority', () => {
    it('run requires public', () => {
      expect(ScaffoldResponseContract.authority.run).toEqual({ requires: 'public' });
    });

    it('receipt requires public', () => {
      expect(ScaffoldResponseContract.authority.receipt).toEqual({ requires: 'public' });
    });

    it('has exactly 2 authority entries', () => {
      expect(Object.keys(ScaffoldResponseContract.authority)).toHaveLength(2);
    });
  });
});

// ── 5. Generator Compatibility ─────────────────────────────────────────────

describe('Generator Compatibility', () => {
  it('generateSDK produces output without error', () => {
    const sdk = generateSDK(ScaffoldResponseContract);
    expect(typeof sdk).toBe('string');
    expect(sdk.length).toBeGreaterThan(0);
  });

  it('generateSDK output contains contract name', () => {
    const sdk = generateSDK(ScaffoldResponseContract);
    expect(sdk).toContain('ScaffoldResponse');
  });

  it('generateSDK output contains run method', () => {
    const sdk = generateSDK(ScaffoldResponseContract);
    expect(sdk).toContain('run(');
  });

  it('generateSDK output contains receipt method', () => {
    const sdk = generateSDK(ScaffoldResponseContract);
    expect(sdk).toContain('receipt(');
  });

  it('generateSDK respects options', () => {
    const sdk = generateSDK(ScaffoldResponseContract, { className: 'ScaffoldClient' });
    expect(sdk).toContain('ScaffoldClient');
  });

  it('generateOpenAPI produces spec without error', () => {
    const spec = generateOpenAPI(ScaffoldResponseContract);
    expect(spec).toBeDefined();
    expect(spec.openapi).toBe('3.1.0');
  });

  it('generateOpenAPI spec has correct info', () => {
    const spec = generateOpenAPI(ScaffoldResponseContract);
    expect(spec.info.title).toContain('ScaffoldResponse');
    expect(spec.info.version).toBe('1.0.0');
    expect(spec.info.description).toBeTruthy();
  });

  it('generateOpenAPI spec includes /run path', () => {
    const spec = generateOpenAPI(ScaffoldResponseContract);
    expect(spec.paths['/run']).toBeDefined();
    expect(spec.paths['/run'].post).toBeDefined();
  });

  it('generateOpenAPI spec includes /receipt/{hash} path', () => {
    const spec = generateOpenAPI(ScaffoldResponseContract);
    expect(spec.paths['/receipt/{hash}']).toBeDefined();
    expect(spec.paths['/receipt/{hash}'].get).toBeDefined();
  });

  it('generateOpenAPI spec has no security schemes (all public)', () => {
    const spec = generateOpenAPI(ScaffoldResponseContract);
    expect(spec.components.securitySchemes).toBeUndefined();
  });

  it('generateOpenAPI spec has component schemas', () => {
    const spec = generateOpenAPI(ScaffoldResponseContract);
    expect(spec.components.schemas).toBeDefined();
    expect(spec.components.schemas['ScaffoldResponse']).toBeDefined();
  });

  it('generateOpenAPI respects server URL option', () => {
    const spec = generateOpenAPI(ScaffoldResponseContract, {
      serverUrl: 'https://tarotscript-worker.blue-pine-edf6.workers.dev',
    });
    expect(spec.servers).toBeDefined();
    expect(spec.servers![0].url).toBe('https://tarotscript-worker.blue-pine-edf6.workers.dev');
  });
});
