import { z } from 'zod';

const nonNegativeInteger = z.number().int().nonnegative();
const nonNegativeFiniteNumber = z.number().finite().nonnegative();

export const GradedRunOutcomeSchema = z.enum(['pass', 'fail', 'error', 'skip']);
export type GradedRunOutcome = z.infer<typeof GradedRunOutcomeSchema>;

export const GradedRunAggregateCountsSchema = z.object({
  total: nonNegativeInteger,
  passed: nonNegativeInteger,
  failed: nonNegativeInteger,
  errored: nonNegativeInteger,
  skipped: nonNegativeInteger,
}).strict().superRefine((counts, ctx) => {
  const subtotal = counts.passed + counts.failed + counts.errored + counts.skipped;
  if (counts.total !== subtotal) {
    ctx.addIssue({
      code: 'custom',
      message: 'total must equal passed + failed + errored + skipped',
      path: ['total'],
    });
  }
});
export type GradedRunAggregateCounts = z.infer<typeof GradedRunAggregateCountsSchema>;

export const GradedRunMetricSummarySchema = z.object({
  count: nonNegativeInteger,
  sum: z.number().finite(),
  avg: z.number().finite(),
  min: z.number().finite(),
  max: z.number().finite(),
}).strict();
export type GradedRunMetricSummary = z.infer<typeof GradedRunMetricSummarySchema>;

export const GradedRunLatencySummarySchema = z.object({
  unit: z.literal('ms'),
  min: nonNegativeFiniteNumber,
  max: nonNegativeFiniteNumber,
  mean: nonNegativeFiniteNumber,
  p50: nonNegativeFiniteNumber,
  p90: nonNegativeFiniteNumber.optional(),
  p95: nonNegativeFiniteNumber,
  p99: nonNegativeFiniteNumber.optional(),
}).strict().superRefine((latency, ctx) => {
  if (latency.min > latency.max) {
    ctx.addIssue({
      code: 'custom',
      message: 'min must be less than or equal to max',
      path: ['min'],
    });
  }

  const ordered = [
    ['p50', latency.p50],
    ['p90', latency.p90],
    ['p95', latency.p95],
    ['p99', latency.p99],
  ] as const;
  const present = ordered.filter((entry): entry is [typeof entry[0], number] => entry[1] !== undefined);
  for (let i = 1; i < present.length; i++) {
    if (present[i - 1][1] > present[i][1]) {
      ctx.addIssue({
        code: 'custom',
        message: 'latency percentiles must be ordered p50 <= p90 <= p95 <= p99 when present',
        path: [present[i - 1][0]],
      });
      break;
    }
  }

  for (const [name, value] of present) {
    if (value > latency.max) {
      ctx.addIssue({
        code: 'custom',
        message: `${name} must be less than or equal to max`,
        path: [name],
      });
    }
  }
});
export type GradedRunLatencySummary = z.infer<typeof GradedRunLatencySummarySchema>;

export const GradedRunScoreSchema = z.object({
  passed: z.boolean(),
  metrics: z.record(z.string(), z.number().finite()).optional(),
  details: z.unknown().optional(),
  reason: z.string().optional(),
}).strict();
export type GradedRunScore = z.infer<typeof GradedRunScoreSchema>;

export const GradedRunCaseSchema = z.object({
  caseId: z.string().min(1),
  input: z.unknown().optional(),
  expected: z.unknown().optional(),
  actual: z.unknown().optional(),
  score: GradedRunScoreSchema.optional(),
}).strict();
export type GradedRunCase = z.infer<typeof GradedRunCaseSchema>;

export const GradedRunMetadataSchema = z.object({
  runId: z.string().uuid(),
  runName: z.string().min(1).max(120),
  runVersion: z.string().min(1).max(40).optional(),
  runner: z.string().min(1).max(120).optional(),
  dataset: z.string().min(1).max(240).optional(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  generatedAt: z.string().datetime(),
  environment: z.enum(['local', 'ci', 'staging', 'production']).optional(),
}).strict();
export type GradedRunMetadata = z.infer<typeof GradedRunMetadataSchema>;

export const GradedRunReportSchema = z.object({
  schemaVersion: z.literal('graded-run-report.v1'),
  run: GradedRunMetadataSchema,
  counts: GradedRunAggregateCountsSchema,
  accuracy: z.number().min(0).max(1).optional(),
  passRate: z.number().min(0).max(1).optional(),
  latency: GradedRunLatencySummarySchema.optional(),
  metrics: z.record(z.string(), GradedRunMetricSummarySchema).optional(),
  cases: z.array(GradedRunCaseSchema).optional(),
}).strict();
export type GradedRunReport = z.infer<typeof GradedRunReportSchema>;
