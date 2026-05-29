import { describe, expect, it } from 'vitest';
import {
  BenchmarkAggregateCountsSchema,
  BenchmarkArtifactDigestSchema,
  BenchmarkLatencySummarySchema,
  BenchmarkReportSchema,
  PublicBenchmarkSummarySchema,
} from '../src/index.js';

const counts = {
  total: 4,
  passed: 2,
  failed: 1,
  errored: 1,
  skipped: 0,
};

const latency = {
  unit: 'ms' as const,
  min: 8,
  max: 80,
  mean: 31,
  p50: 24,
  p95: 62,
  p99: 77,
};

const artifact = {
  artifactType: 'aggregate-report',
  algorithm: 'sha256' as const,
  digest: 'a'.repeat(64),
  byteSize: 2048,
};

describe('benchmark report primitives', () => {
  it('validates a generic benchmark report', () => {
    const result = BenchmarkReportSchema.safeParse({
      schemaVersion: 'benchmark-report.v1',
      run: {
        runId: '123e4567-e89b-12d3-a456-426614174000',
        benchmarkName: 'synthetic-routing-benchmark',
        benchmarkVersion: '1.0.0',
        generatedAt: '2026-05-29T10:00:00.000Z',
        environment: 'ci',
      },
      counts,
      latency,
      inferenceCalls: {
        totalCalls: 4,
        successfulCalls: 3,
        failedCalls: 1,
      },
      cost: {
        currencyCode: 'USD',
        totalCostMicros: 12000,
        meanCostMicros: 3000,
      },
      artifacts: [artifact],
    });

    expect(result.success).toBe(true);
  });

  it('validates a sanitized public summary without run identity', () => {
    const result = PublicBenchmarkSummarySchema.safeParse({
      schemaVersion: 'public-benchmark-summary.v1',
      benchmarkName: 'synthetic-routing-benchmark',
      benchmarkVersion: '1.0.0',
      generatedAt: '2026-05-29T10:00:00.000Z',
      counts,
      latency,
      artifacts: [artifact],
    });

    expect(result.success).toBe(true);
  });

  it('rejects inconsistent aggregate counts', () => {
    const result = BenchmarkAggregateCountsSchema.safeParse({
      total: 4,
      passed: 4,
      failed: 1,
      errored: 0,
      skipped: 0,
    });

    expect(result.success).toBe(false);
  });

  it('rejects unordered latency percentiles', () => {
    const result = BenchmarkLatencySummarySchema.safeParse({
      ...latency,
      p50: 70,
      p95: 60,
    });

    expect(result.success).toBe(false);
  });

  it('rejects private evidence fields on public summaries', () => {
    const result = PublicBenchmarkSummarySchema.safeParse({
      schemaVersion: 'public-benchmark-summary.v1',
      benchmarkName: 'synthetic-routing-benchmark',
      benchmarkVersion: '1.0.0',
      generatedAt: '2026-05-29T10:00:00.000Z',
      counts,
      rawPrompt: 'private prompt text',
      rawOutput: 'private model output',
      endpointUrl: 'https://example.internal/eval-target',
      scorerWeights: { structure: 0.5 },
      caseId: 'private-case-001',
    });

    expect(result.success).toBe(false);
  });

  it('rejects file paths and urls in artifact digests', () => {
    const result = BenchmarkArtifactDigestSchema.safeParse({
      ...artifact,
      filePath: '/private/reports/run.json',
      url: 'https://example.internal/reports/run.json',
    });

    expect(result.success).toBe(false);
  });
});
