import { z } from 'zod';
import { defineContract } from '../core/index.js';

/**
 * CcTask — canonical shape for AEGIS Claude Code task queue entries.
 *
 * This contract is the single source of truth for the cc_tasks D1 table.
 * When adding a new executor value or column, update this contract first,
 * then generate the migration from it via generateSQL().
 *
 * Drift prevention: migrations that recreate cc_tasks (needed to ALTER a CHECK
 * constraint in SQLite) MUST list all columns from CC_TASK_COLUMNS in their
 * INSERT ... SELECT statements. Never hand-write the column list — import it.
 *
 * History: migrations 0041+0042 hand-wrote the column list and silently dropped
 * 7 columns (preflight_json, retryable, autopsy_json, adversarial_json, job_id,
 * branch, utility_json). Migration 0044 restored them. This contract prevents
 * the same class of bug in all future table recreations.
 */

export const CcTaskStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);
export type CcTaskStatus = z.infer<typeof CcTaskStatusSchema>;

export const CcTaskAuthoritySchema = z.enum(['operator', 'auto_safe', 'proposed']);
export type CcTaskAuthority = z.infer<typeof CcTaskAuthoritySchema>;

export const CcTaskCategorySchema = z.enum(['docs', 'tests', 'research', 'bugfix', 'feature', 'refactor', 'deploy']);
export type CcTaskCategory = z.infer<typeof CcTaskCategorySchema>;

export const CcTaskExecutorSchema = z.enum(['claude_code', 'workers_ai', 'do_sandbox', 'tarotscript']);
export type CcTaskExecutor = z.infer<typeof CcTaskExecutorSchema>;

export const CcTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500),
  prompt: z.string().min(1),
  repo: z.string().min(1).default('aegis'),
  category: CcTaskCategorySchema.default('feature'),
  status: CcTaskStatusSchema.default('pending'),
  authority: CcTaskAuthoritySchema.default('operator'),
  executor: CcTaskExecutorSchema.default('claude_code'),
  priority: z.number().int().min(0).max(100).default(5),
  max_turns: z.number().int().positive().nullable().optional(),
  completion_signal: z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
  result: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  failure_kind: z.string().nullable().optional(),
  exit_code: z.number().int().nullable().optional(),
  pr_url: z.string().url().nullable().optional(),
  business_unit: z.string().min(1).default('stackbilt'),
  created_at: z.string().datetime(),
  started_at: z.string().datetime().nullable().optional(),
  completed_at: z.string().datetime().nullable().optional(),
  created_by: z.string().min(1).default('operator'),
  depends_on: z.string().uuid().nullable().optional(),
  blocked_by: z.string().nullable().optional(),
  allowed_tools: z.string().nullable().optional(),
  github_issue_repo: z.string().nullable().optional(),
  github_issue_number: z.number().int().positive().nullable().optional(),
  preflight_json: z.string().nullable().optional(),
  retryable: z.number().int().min(0).max(1).default(0),
  autopsy_json: z.string().nullable().optional(),
  adversarial_json: z.string().nullable().optional(),
  job_id: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  utility_json: z.string().nullable().optional(),
});
export type CcTask = z.infer<typeof CcTaskSchema>;

export const CcTaskInputSchema = CcTaskSchema.omit({
  id: true,
  created_at: true,
  started_at: true,
  completed_at: true,
  session_id: true,
  result: true,
  error: true,
  exit_code: true,
  pr_url: true,
  failure_kind: true,
  retryable: true,
  preflight_json: true,
  autopsy_json: true,
  adversarial_json: true,
  branch: true,
  utility_json: true,
});
export type CcTaskInput = z.infer<typeof CcTaskInputSchema>;

/**
 * Canonical ordered column list for cc_tasks.
 * Use this in any migration that recreates the table to avoid silent column drops.
 *
 * @example
 * // In a migration that must recreate cc_tasks to alter a CHECK constraint:
 * // INSERT INTO cc_tasks SELECT ${CC_TASK_COLUMNS.join(', ')} FROM cc_tasks_tmp;
 */
export const CC_TASK_COLUMNS = [
  'id', 'title', 'prompt', 'repo', 'category', 'status', 'authority', 'executor',
  'priority', 'max_turns', 'completion_signal', 'session_id', 'result', 'error',
  'failure_kind', 'exit_code', 'pr_url', 'business_unit', 'created_at', 'started_at',
  'completed_at', 'created_by', 'depends_on', 'blocked_by', 'allowed_tools',
  'github_issue_repo', 'github_issue_number', 'preflight_json', 'retryable',
  'autopsy_json', 'adversarial_json', 'job_id', 'branch', 'utility_json',
] as const;

export const CcTaskContract = defineContract({
  name: 'CcTask',
  version: '1.0.0',
  description: 'AEGIS Claude Code task queue — autonomous task dispatch and tracking',

  schema: CcTaskSchema,

  operations: {
    create: {
      input: CcTaskInputSchema,
      output: 'self' as const,
      transition: { from: [], to: 'pending' },
      emits: ['cc_task.created'],
    },
    claim: {
      input: z.object({ id: z.string().uuid(), session_id: z.string(), preflight_json: z.string().nullable().optional() }),
      output: 'self' as const,
      transition: { from: ['pending'], to: 'running' },
      emits: ['cc_task.claimed'],
    },
    complete: {
      input: z.object({ id: z.string().uuid(), result: z.string().optional(), exit_code: z.number().int().optional(), pr_url: z.string().optional() }),
      output: 'self' as const,
      transition: { from: ['running'], to: 'completed' },
      emits: ['cc_task.completed'],
    },
    fail: {
      input: z.object({
        id: z.string().uuid(),
        error: z.string(),
        exit_code: z.number().int().optional(),
        failure_kind: z.string().optional(),
        retryable: z.boolean().optional(),
        autopsy_json: z.string().optional(),
        preflight_json: z.string().optional(),
      }),
      output: 'self' as const,
      transition: { from: ['running'], to: 'failed' },
      emits: ['cc_task.failed'],
    },
    cancel: {
      input: z.object({ id: z.string().uuid() }),
      output: 'self' as const,
      transition: { from: ['pending', 'running'], to: 'cancelled' },
      emits: ['cc_task.cancelled'],
    },
  },

  states: {
    field: 'status',
    initial: 'pending',
    transitions: {
      pending: { claim: 'running', cancel: 'cancelled' },
      running: { complete: 'completed', fail: 'failed', cancel: 'cancelled' },
      completed: {},
      failed: {},
      cancelled: {},
    },
  },

  surfaces: {
    db: {
      table: 'cc_tasks',
      indexes: [
        'idx_cc_tasks_status(status, priority)',
        'idx_cc_tasks_executor(executor, status, priority)',
        'idx_cc_tasks_created(created_at)',
        'idx_cc_tasks_authority(authority)',
        'idx_cc_tasks_depends(depends_on)',
        'idx_cc_tasks_gh_issue(github_issue_repo, github_issue_number)',
        'idx_cc_tasks_failure_kind(failure_kind, completed_at)',
        'idx_cc_tasks_job_id(job_id)',
        'idx_cc_tasks_bu(business_unit, status)',
      ],
      columnOverrides: {
        created_at: { default: "(datetime('now'))" },
      },
    },
  },

  authority: {
    create: { requires: 'role', roles: ['operator', 'system'] },
    claim: { requires: 'role', roles: ['system'] },
    complete: { requires: 'role', roles: ['system'] },
    fail: { requires: 'role', roles: ['system'] },
    cancel: { requires: 'role', roles: ['operator', 'system'] },
  },
});
