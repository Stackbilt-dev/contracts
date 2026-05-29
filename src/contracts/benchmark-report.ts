import { z } from 'zod';
import {
  GradedRunAggregateCountsSchema,
  GradedRunLatencySummarySchema,
  GradedRunOutcomeSchema,
} from './graded-run.js';

const nonNegativeInteger = z.number().int().nonnegative();

export const BenchmarkOutcomeSchema = GradedRunOutcomeSchema;
export type BenchmarkOutcome = z.infer<typeof BenchmarkOutcomeSchema>;

export const BenchmarkAggregateCountsSchema = GradedRunAggregateCountsSchema;
export type BenchmarkAggregateCounts = z.infer<typeof BenchmarkAggregateCountsSchema>;

export const BenchmarkLatencySummarySchema = GradedRunLatencySummarySchema.required({ p99: true });
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
