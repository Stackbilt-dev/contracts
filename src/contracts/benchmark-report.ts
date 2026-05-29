import { z } from 'zod';

const nonNegativeInteger = z.number().int().nonnegative();
const nonNegativeFiniteNumber = z.number().finite().nonnegative();

export const BenchmarkOutcomeSchema = z.enum(['pass', 'fail', 'error', 'skip']);
export type BenchmarkOutcome = z.infer<typeof BenchmarkOutcomeSchema>;

export const BenchmarkAggregateCountsSchema = z.object({
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
export type BenchmarkAggregateCounts = z.infer<typeof BenchmarkAggregateCountsSchema>;

export const BenchmarkLatencySummarySchema = z.object({
  unit: z.literal('ms'),
  min: nonNegativeFiniteNumber,
  max: nonNegativeFiniteNumber,
  mean: nonNegativeFiniteNumber,
  p50: nonNegativeFiniteNumber,
  p95: nonNegativeFiniteNumber,
  p99: nonNegativeFiniteNumber,
}).strict().superRefine((latency, ctx) => {
  if (latency.min > latency.max) {
    ctx.addIssue({
      code: 'custom',
      message: 'min must be less than or equal to max',
      path: ['min'],
    });
  }

  if (latency.p50 > latency.p95 || latency.p95 > latency.p99) {
    ctx.addIssue({
      code: 'custom',
      message: 'latency percentiles must be ordered p50 <= p95 <= p99',
      path: ['p50'],
    });
  }

  if (latency.p99 > latency.max) {
    ctx.addIssue({
      code: 'custom',
      message: 'p99 must be less than or equal to max',
      path: ['p99'],
    });
  }
});
export type BenchmarkLatencySummary = z.infer<typeof BenchmarkLatencySummarySchema>;

export const BenchmarkInferenceCallSummarySchema = z.object({
  totalCalls: nonNegativeInteger,
  successfulCalls: nonNegativeInteger,
  failedCalls: nonNegativeInteger,
}).strict().superRefine((summary, ctx) => {
  if (summary.totalCalls !== summary.successfulCalls + summary.failedCalls) {
    ctx.addIssue({
      code: 'custom',
      message: 'totalCalls must equal successfulCalls + failedCalls',
      path: ['totalCalls'],
    });
  }
});
export type BenchmarkInferenceCallSummary = z.infer<typeof BenchmarkInferenceCallSummarySchema>;

export const BenchmarkCostSummarySchema = z.object({
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  totalCostMicros: nonNegativeInteger,
  meanCostMicros: nonNegativeInteger,
}).strict();
export type BenchmarkCostSummary = z.infer<typeof BenchmarkCostSummarySchema>;

export const BenchmarkArtifactDigestSchema = z.object({
  artifactType: z.string().min(1).max(100),
  algorithm: z.enum(['sha256', 'sha512', 'blake3']),
  digest: z.string().regex(/^[a-f0-9]+$/).min(32).max(256),
  byteSize: nonNegativeInteger.optional(),
}).strict();
export type BenchmarkArtifactDigest = z.infer<typeof BenchmarkArtifactDigestSchema>;

export const BenchmarkRunMetadataSchema = z.object({
  runId: z.string().uuid(),
  benchmarkName: z.string().min(1).max(120),
  benchmarkVersion: z.string().min(1).max(40),
  generatedAt: z.string().datetime(),
  environment: z.enum(['local', 'ci', 'staging', 'production']).optional(),
}).strict();
export type BenchmarkRunMetadata = z.infer<typeof BenchmarkRunMetadataSchema>;

export const BenchmarkReportSchema = z.object({
  schemaVersion: z.literal('benchmark-report.v1'),
  run: BenchmarkRunMetadataSchema,
  counts: BenchmarkAggregateCountsSchema,
  latency: BenchmarkLatencySummarySchema.optional(),
  inferenceCalls: BenchmarkInferenceCallSummarySchema.optional(),
  cost: BenchmarkCostSummarySchema.optional(),
  artifacts: z.array(BenchmarkArtifactDigestSchema).max(20).optional(),
}).strict();
export type BenchmarkReport = z.infer<typeof BenchmarkReportSchema>;

export const PublicBenchmarkSummarySchema = z.object({
  schemaVersion: z.literal('public-benchmark-summary.v1'),
  benchmarkName: z.string().min(1).max(120),
  benchmarkVersion: z.string().min(1).max(40),
  generatedAt: z.string().datetime(),
  counts: BenchmarkAggregateCountsSchema,
  latency: BenchmarkLatencySummarySchema.optional(),
  inferenceCalls: BenchmarkInferenceCallSummarySchema.optional(),
  cost: BenchmarkCostSummarySchema.optional(),
  artifacts: z.array(BenchmarkArtifactDigestSchema).max(20).optional(),
}).strict();
export type PublicBenchmarkSummary = z.infer<typeof PublicBenchmarkSummarySchema>;

