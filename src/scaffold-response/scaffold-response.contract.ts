/**
 * Scaffold Response Contract
 *
 * Defines the response shape for TarotScript's scaffold-cast spread.
 * This is the canonical schema for /run (scaffold-cast) and /receipt/:hash
 * responses consumed by stackbilt-web, the Oracle pass, and future agents.
 *
 * Inaugural signed contract in @stackbilt/contracts.
 */

import { z } from 'zod';
import { defineContract } from '../core/index.js';

// ── Schema Version ──────────────────────────────────────────────────────

export const SchemaVersion = z.literal(1);

// ── File Role ───────────────────────────────────────────────────────────

export const FileRole = z.enum(['config', 'scaffold', 'governance', 'test', 'doc']);

// ── Scaffold File ───────────────────────────────────────────────────────

export const ScaffoldFile = z.object({
  path: z.string(),
  content: z.string(),
  role: FileRole,
});

// ── Governance Docs ─────────────────────────────────────────────────────

export const GovernanceDocs = z.object({
  threat_model: z.string(),
  adr: z.string(),
  test_plan: z.string(),
});

// ── Prompt Context (grouped domains for Oracle LLM pass) ────────────────

export const PromptContextMeta = z.object({
  project_type: z.string(),
  complexity: z.string(),
  confidence: z.string(),
  seed: z.number(),
});

export const PromptContextRequirement = z.object({
  name: z.string(),
  priority: z.string(),
  effort: z.string(),
  acceptance: z.string(),
});

export const PromptContextInterface = z.object({
  name: z.string(),
  layout: z.string(),
  components: z.string(),
});

export const PromptContextThreat = z.object({
  name: z.string(),
  owasp: z.string(),
  likelihood: z.string(),
  impact: z.string(),
  mitigation: z.string(),
  detection: z.string(),
  response_time: z.string(),
});

export const PromptContextRuntime = z.object({
  name: z.string(),
  tier: z.string(),
  traits: z.string(),
});

export const PromptContextTestPlan = z.object({
  name: z.string(),
  framework: z.string(),
  ci_stage: z.string(),
  coverage: z.string(),
  setup: z.string(),
  assertion_style: z.string(),
});

export const PromptContextFirstTask = z.object({
  name: z.string(),
  estimate: z.string(),
  complexity: z.string(),
  deliverable: z.string(),
  adr: z.string(),
});

export const PromptContext = z.object({
  intention: z.string(),
  pattern: z.string(),
  meta: PromptContextMeta,
  requirement: PromptContextRequirement,
  interface: PromptContextInterface,
  threat: PromptContextThreat,
  runtime: PromptContextRuntime,
  test_plan: PromptContextTestPlan,
  first_task: PromptContextFirstTask,
  governance: GovernanceDocs,
  files: z.array(ScaffoldFile),
});

// ── Materializer Result (top-level scaffold output) ─────────────────────

export const MaterializerResult = z.object({
  files: z.array(ScaffoldFile),
  nextSteps: z.array(z.string()),
  promptContext: PromptContext,
});

// ── Contract Definition ─────────────────────────────────────────────────

export const ScaffoldResponseContract = defineContract({
  name: 'ScaffoldResponse',
  version: '1.0.0',
  description: 'Response contract for TarotScript scaffold-cast readings — files, governance, and prompt context for downstream consumers.',

  schema: z.object({
    schema_version: SchemaVersion,
    files: z.array(ScaffoldFile),
    nextSteps: z.array(z.string()),
    promptContext: PromptContext,
    governance: GovernanceDocs,
  }),

  operations: {
    run: {
      input: z.object({
        spreadType: z.literal('scaffold-cast'),
        querent: z.object({
          id: z.string().optional(),
          intention: z.string(),
          state: z.object({
            complexity: z.string().optional(),
            project_type: z.string().optional(),
            pattern: z.string().optional(),
          }).optional(),
        }),
        responseMode: z.enum(['structured-only', 'symbolic', 'full']).optional(),
        inscribe: z.boolean().optional(),
        seed: z.number().optional(),
      }),
      output: 'self' as const,
    },
    receipt: {
      input: z.object({
        hash: z.string(),
      }),
      output: 'self' as const,
    },
  },

  surfaces: {
    api: {
      basePath: '',
      routes: {
        run: { method: 'POST', path: '/run' },
        receipt: { method: 'GET', path: '/receipt/:hash' },
      },
    },
  },

  authority: {
    run: { requires: 'public' },
    receipt: { requires: 'public' },
  },
});

// ── Inferred Types (for import by worker and consumers) ─────────────────

export type ScaffoldFile = z.infer<typeof ScaffoldFile>;
export type FileRole = z.infer<typeof FileRole>;
export type GovernanceDocs = z.infer<typeof GovernanceDocs>;
export type PromptContext = z.infer<typeof PromptContext>;
export type MaterializerResult = z.infer<typeof MaterializerResult>;
export type SchemaVersion = z.infer<typeof SchemaVersion>;
