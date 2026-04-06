/**
 * Agent Response Contract Tests
 *
 * Validates the canonical response shape for TarotScript's agent-cast spread.
 * Covers schema validation, rejection, enum coverage, contract definition, and
 * generator compatibility.
 */

import { describe, it, expect } from 'vitest';
import {
  AgentResponseContract,
  AgentRole,
  AgentDeckSlot,
  ResponseMode,
  ConfidenceLevel,
  Orientation,
  AgentDeckRef,
  AgentManifest,
  AgentPositionAnalysis,
  AgentAnalysis,
  AgentGuidance,
  AgentReceipt,
  AgentRunMetadata,
  AgentRunResult,
  SchemaVersion,
} from '../src/agent-response/index.js';
import { generateSDK, generateOpenAPI } from '../src/generators/index.js';

// ── Realistic test fixtures ────────────────────────────────────────────────

const validPositions: ReturnType<typeof AgentPositionAnalysis.parse>[] = [
  {
    position: 'stance',
    cardName: 'Pragmatic Architect',
    element: 'earth',
    orientation: 'upright',
    deckSlot: 'persona',
    properties: { communication_style: 'direct-technical', decision_pattern: 'evidence-first' },
  },
  {
    position: 'domain_lens',
    cardName: 'Platform Lock-In',
    element: 'fire',
    orientation: 'upright',
    deckSlot: 'domain',
    properties: { expertise_area: 'cloud-architecture', pain_category: 'vendor-dependency' },
  },
  {
    position: 'guardrail',
    cardName: 'Data Residency Gate',
    element: 'water',
    orientation: 'upright',
    deckSlot: 'governance',
    properties: { risk_level: 'critical', enforcement: 'hard', scope: 'data-sovereignty' },
  },
  {
    position: 'recommended_action',
    cardName: 'Multi-Cloud Abstraction',
    element: 'air',
    orientation: 'upright',
    deckSlot: 'actions',
    properties: { action_type: 'architecture', effort: 'high', time_horizon: 'quarter' },
  },
  {
    position: 'confidence',
    cardName: 'Migration Fatigue',
    element: 'earth',
    orientation: 'reversed',
    deckSlot: 'domain',
    properties: { pain_category: 'operational-burden', cost_tier: 'high', symptom: 'team-velocity-drop' },
  },
];

const validAnalysis: ReturnType<typeof AgentAnalysis.parse> = {
  stance: 'Pragmatic Architect',
  domainLens: 'Platform Lock-In',
  constraint: 'Data Residency Gate',
  recommendedAction: 'Multi-Cloud Abstraction',
  confidence: 'medium',
  confidenceScore: 0.65,
  positions: validPositions,
};

const validGuidance: ReturnType<typeof AgentGuidance.parse> = {
  recommendation: 'Introduce a thin cloud abstraction layer at the infrastructure boundary before expanding to additional providers.',
  constraints: 'Data residency requirements mandate EU-only storage for PII. Any multi-cloud strategy must preserve this invariant.',
  risks: 'Migration fatigue is already present in the team. Phase the abstraction incrementally — do not attempt a big-bang rewrite.',
};

const validReceipt: ReturnType<typeof AgentReceipt.parse> = {
  hash: 'a1b2c3d4e5f6',
  seed: 42,
  timestamp: '2026-04-04T12:00:00.000Z',
};

const validMetadata: ReturnType<typeof AgentRunMetadata.parse> = {
  latencyMs: 340,
  manifestVersion: 1,
  decksLoaded: ['persona', 'domain', 'governance', 'actions'],
};

const validRunResult: ReturnType<typeof AgentRunResult.parse> = {
  schema_version: 1,
  success: true,
  role: 'cto',
  response: 'CTO Agent — medium confidence (65%). Stance: Pragmatic Architect — evidence-first. Domain: Platform Lock-In — cloud-architecture. Constraint: Data Residency Gate [hard] — data-sovereignty. Action: Multi-Cloud Abstraction [architecture], effort: high, horizon: quarter.',
  symbolicResponse: 'The Pragmatic Architect surveys the landscape...',
  analysis: validAnalysis,
  guidance: validGuidance,
  receipt: validReceipt,
  responseMode: 'natural',
  metadata: validMetadata,
};

const validManifest: ReturnType<typeof AgentManifest.parse> = {
  manifestVersion: 1,
  identity: {
    role: 'cto',
    name: 'CTO Agent',
    description: 'Chief Technology Officer — architecture, platform strategy, technical leadership',
    version: '0.1.0',
    generatedAt: '2026-04-04T12:00:00.000Z',
  },
  decks: {
    persona: { slot: 'persona', path: 'decks/agents/cto-persona.deck', name: 'cto_persona' },
    domain: { slot: 'domain', path: 'decks/agents/cto-domain.deck', name: 'cto_domain' },
    governance: { slot: 'governance', path: 'decks/agents/cto-governance.deck', name: 'cto_governance' },
    actions: { slot: 'actions', path: 'decks/agents/cto-actions.deck', name: 'cto_actions' },
  },
  tags: ['c-level', 'technology', 'architecture'],
};

// ── 1. Schema Validation ───────────────────────────────────────────────────

describe('Schema Validation', () => {
  it('parses a valid AgentPositionAnalysis', () => {
    const result = AgentPositionAnalysis.safeParse(validPositions[0]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.position).toBe('stance');
      expect(result.data.cardName).toBe('Pragmatic Architect');
      expect(result.data.deckSlot).toBe('persona');
    }
  });

  it('parses all 5 positions with realistic content', () => {
    for (const pos of validPositions) {
      const result = AgentPositionAnalysis.safeParse(pos);
      expect(result.success).toBe(true);
    }
  });

  it('parses valid AgentAnalysis', () => {
    const result = AgentAnalysis.safeParse(validAnalysis);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stance).toBe('Pragmatic Architect');
      expect(result.data.confidence).toBe('medium');
      expect(result.data.confidenceScore).toBe(0.65);
      expect(result.data.positions).toHaveLength(5);
    }
  });

  it('parses valid AgentGuidance', () => {
    const result = AgentGuidance.safeParse(validGuidance);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recommendation).toContain('abstraction layer');
      expect(result.data.constraints).toContain('Data residency');
      expect(result.data.risks).toContain('fatigue');
    }
  });

  it('parses valid AgentReceipt', () => {
    const result = AgentReceipt.safeParse(validReceipt);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hash).toBe('a1b2c3d4e5f6');
      expect(result.data.seed).toBe(42);
    }
  });

  it('parses valid AgentRunMetadata', () => {
    const result = AgentRunMetadata.safeParse(validMetadata);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.latencyMs).toBe(340);
      expect(result.data.decksLoaded).toHaveLength(4);
    }
  });

  it('parses the full AgentRunResult', () => {
    const result = AgentRunResult.safeParse(validRunResult);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema_version).toBe(1);
      expect(result.data.success).toBe(true);
      expect(result.data.role).toBe('cto');
      expect(result.data.analysis.positions).toHaveLength(5);
      expect(result.data.receipt.hash).toBe('a1b2c3d4e5f6');
    }
  });

  it('parses AgentRunResult without optional guidance', () => {
    const { guidance, ...noGuidance } = validRunResult;
    const result = AgentRunResult.safeParse(noGuidance);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.guidance).toBeUndefined();
    }
  });

  it('parses valid AgentManifest', () => {
    const result = AgentManifest.safeParse(validManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.identity.role).toBe('cto');
      expect(result.data.decks.persona.slot).toBe('persona');
      expect(result.data.tags).toContain('architecture');
    }
  });

  it('parses the full contract schema payload', () => {
    const result = AgentResponseContract.schema.safeParse(validRunResult);
    expect(result.success).toBe(true);
  });

  it('parses SchemaVersion literal', () => {
    expect(SchemaVersion.safeParse(1).success).toBe(true);
  });
});

// ── 2. Rejection ───────────────────────────────────────────────────────────

describe('Rejection', () => {
  it('rejects AgentPositionAnalysis missing position', () => {
    const { position, ...rest } = validPositions[0];
    expect(AgentPositionAnalysis.safeParse(rest).success).toBe(false);
  });

  it('rejects AgentPositionAnalysis missing cardName', () => {
    const { cardName, ...rest } = validPositions[0];
    expect(AgentPositionAnalysis.safeParse(rest).success).toBe(false);
  });

  it('rejects AgentPositionAnalysis with invalid orientation', () => {
    expect(AgentPositionAnalysis.safeParse({ ...validPositions[0], orientation: 'sideways' }).success).toBe(false);
  });

  it('rejects AgentAnalysis missing stance', () => {
    const { stance, ...rest } = validAnalysis;
    expect(AgentAnalysis.safeParse(rest).success).toBe(false);
  });

  it('rejects AgentAnalysis with confidenceScore > 1', () => {
    expect(AgentAnalysis.safeParse({ ...validAnalysis, confidenceScore: 1.5 }).success).toBe(false);
  });

  it('rejects AgentAnalysis with confidenceScore < 0', () => {
    expect(AgentAnalysis.safeParse({ ...validAnalysis, confidenceScore: -0.1 }).success).toBe(false);
  });

  it('rejects AgentAnalysis with invalid confidence level', () => {
    expect(AgentAnalysis.safeParse({ ...validAnalysis, confidence: 'extreme' }).success).toBe(false);
  });

  it('rejects AgentGuidance missing recommendation', () => {
    const { recommendation, ...rest } = validGuidance;
    expect(AgentGuidance.safeParse(rest).success).toBe(false);
  });

  it('rejects AgentGuidance missing constraints', () => {
    const { constraints, ...rest } = validGuidance;
    expect(AgentGuidance.safeParse(rest).success).toBe(false);
  });

  it('rejects AgentGuidance missing risks', () => {
    const { risks, ...rest } = validGuidance;
    expect(AgentGuidance.safeParse(rest).success).toBe(false);
  });

  it('rejects AgentReceipt missing hash', () => {
    const { hash, ...rest } = validReceipt;
    expect(AgentReceipt.safeParse(rest).success).toBe(false);
  });

  it('rejects AgentReceipt missing seed', () => {
    const { seed, ...rest } = validReceipt;
    expect(AgentReceipt.safeParse(rest).success).toBe(false);
  });

  it('rejects AgentRunResult missing analysis', () => {
    const { analysis, ...rest } = validRunResult;
    expect(AgentRunResult.safeParse(rest).success).toBe(false);
  });

  it('rejects AgentRunResult missing receipt', () => {
    const { receipt, ...rest } = validRunResult;
    expect(AgentRunResult.safeParse(rest).success).toBe(false);
  });

  it('rejects AgentRunResult missing metadata', () => {
    const { metadata, ...rest } = validRunResult;
    expect(AgentRunResult.safeParse(rest).success).toBe(false);
  });

  it('rejects wrong schema_version', () => {
    expect(AgentRunResult.safeParse({ ...validRunResult, schema_version: 2 }).success).toBe(false);
  });

  it('rejects schema_version as string', () => {
    expect(AgentRunResult.safeParse({ ...validRunResult, schema_version: '1' }).success).toBe(false);
  });

  it('rejects invalid role', () => {
    expect(AgentRunResult.safeParse({ ...validRunResult, role: 'janitor' }).success).toBe(false);
  });

  it('rejects invalid responseMode', () => {
    expect(AgentRunResult.safeParse({ ...validRunResult, responseMode: 'verbose' }).success).toBe(false);
  });

  it('rejects AgentManifest with wrong manifestVersion', () => {
    expect(AgentManifest.safeParse({ ...validManifest, manifestVersion: 2 }).success).toBe(false);
  });

  it('rejects AgentManifest missing decks', () => {
    const { decks, ...rest } = validManifest;
    expect(AgentManifest.safeParse(rest).success).toBe(false);
  });

  it('rejects completely empty object', () => {
    expect(AgentResponseContract.schema.safeParse({}).success).toBe(false);
  });

  it('rejects null', () => {
    expect(AgentResponseContract.schema.safeParse(null).success).toBe(false);
  });

  it('rejects undefined', () => {
    expect(AgentResponseContract.schema.safeParse(undefined).success).toBe(false);
  });
});

// ── 3. Enum Coverage ──────────────────────────────────────────────────────

describe('AgentRole Enum', () => {
  const validRoles = ['cto', 'ciso', 'cfo', 'cmo', 'cpo', 'architect'] as const;

  it.each(validRoles)('accepts "%s"', (role) => {
    expect(AgentRole.safeParse(role).success).toBe(true);
  });

  it('has exactly 6 roles', () => {
    expect(AgentRole.options).toHaveLength(6);
    expect(AgentRole.options).toEqual(expect.arrayContaining(validRoles));
  });

  const invalidRoles = ['ceo', 'vp', 'manager', '', 'CTO', 'Architect', 123, null];

  it.each(invalidRoles)('rejects invalid role: %s', (role) => {
    expect(AgentRole.safeParse(role).success).toBe(false);
  });
});

describe('AgentDeckSlot Enum', () => {
  const validSlots = ['persona', 'domain', 'governance', 'actions', 'memory'] as const;

  it.each(validSlots)('accepts "%s"', (slot) => {
    expect(AgentDeckSlot.safeParse(slot).success).toBe(true);
  });

  it('has 5 slots (4 core + memory)', () => {
    expect(AgentDeckSlot.options).toHaveLength(5);
  });

  it.each(['personality', 'rules', 'tools', '', null])('rejects invalid slot: %s', (slot) => {
    expect(AgentDeckSlot.safeParse(slot).success).toBe(false);
  });
});

describe('ConfidenceLevel Enum', () => {
  it.each(['high', 'medium', 'low'])('accepts "%s"', (level) => {
    expect(ConfidenceLevel.safeParse(level).success).toBe(true);
  });

  it('has exactly 3 levels', () => {
    expect(ConfidenceLevel.options).toHaveLength(3);
  });

  it.each(['extreme', 'none', '', null])('rejects invalid level: %s', (level) => {
    expect(ConfidenceLevel.safeParse(level).success).toBe(false);
  });
});

describe('ResponseMode Enum', () => {
  it.each(['symbolic', 'natural', 'structured-only'])('accepts "%s"', (mode) => {
    expect(ResponseMode.safeParse(mode).success).toBe(true);
  });

  it('has exactly 3 modes', () => {
    expect(ResponseMode.options).toHaveLength(3);
  });

  it.each(['verbose', 'raw', 'full', '', null])('rejects invalid mode: %s', (mode) => {
    expect(ResponseMode.safeParse(mode).success).toBe(false);
  });
});

describe('Orientation Enum', () => {
  it.each(['upright', 'reversed'])('accepts "%s"', (o) => {
    expect(Orientation.safeParse(o).success).toBe(true);
  });

  it('has exactly 2 values', () => {
    expect(Orientation.options).toHaveLength(2);
  });

  it.each(['sideways', 'inverted', '', null])('rejects invalid orientation: %s', (o) => {
    expect(Orientation.safeParse(o).success).toBe(false);
  });
});

// ── 4. Contract Definition ─────────────────────────────────────────────────

describe('Contract Definition', () => {
  it('has correct name', () => {
    expect(AgentResponseContract.name).toBe('AgentResponse');
  });

  it('has correct version', () => {
    expect(AgentResponseContract.version).toBe('2.0.0');
  });

  it('has a description', () => {
    expect(AgentResponseContract.description).toBeTruthy();
    expect(typeof AgentResponseContract.description).toBe('string');
  });

  describe('surfaces', () => {
    it('defines an api surface', () => {
      expect(AgentResponseContract.surfaces.api).toBeDefined();
    });

    it('has /agents basePath', () => {
      expect(AgentResponseContract.surfaces.api!.basePath).toBe('/agents');
    });

    it('defines POST /run route', () => {
      const run = AgentResponseContract.surfaces.api!.routes.run;
      expect(run).toBeDefined();
      expect(run.method).toBe('POST');
      expect(run.path).toBe('/run');
    });

    it('has 5 routes', () => {
      expect(Object.keys(AgentResponseContract.surfaces.api!.routes)).toHaveLength(5);
    });
  });

  describe('operations', () => {
    it('defines run operation', () => {
      expect(AgentResponseContract.operations.run).toBeDefined();
    });

    it('run operation output is self', () => {
      expect(AgentResponseContract.operations.run.output).toBe('self');
    });

    it('run operation input requires intention', () => {
      const validInput = { intention: 'evaluate our cloud migration strategy' };
      const result = AgentResponseContract.operations.run.input.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('run operation input rejects missing intention', () => {
      const result = AgentResponseContract.operations.run.input.safeParse({ role: 'cto' });
      expect(result.success).toBe(false);
    });

    it('run operation input accepts all optional fields', () => {
      const fullInput = {
        role: 'cto',
        intention: 'evaluate our cloud migration strategy',
        context: { industry: 'fintech', team_size: '50', stage: 'growth' },
        painSignals: ['vendor lock-in', 'compliance gaps', 'team velocity decline'],
        responseMode: 'natural',
        seed: 42,
      };
      const result = AgentResponseContract.operations.run.input.safeParse(fullInput);
      expect(result.success).toBe(true);
    });

    it('run operation input rejects invalid role', () => {
      const result = AgentResponseContract.operations.run.input.safeParse({
        role: 'janitor',
        intention: 'test',
      });
      expect(result.success).toBe(false);
    });

    it('run operation input rejects invalid responseMode', () => {
      const result = AgentResponseContract.operations.run.input.safeParse({
        intention: 'test',
        responseMode: 'verbose',
      });
      expect(result.success).toBe(false);
    });

    it('has 5 operations', () => {
      expect(Object.keys(AgentResponseContract.operations)).toHaveLength(5);
    });
  });

  describe('authority', () => {
    it('run requires authenticated', () => {
      expect(AgentResponseContract.authority.run).toEqual({ requires: 'authenticated' });
    });

    it('has 5 authority entries', () => {
      expect(Object.keys(AgentResponseContract.authority)).toHaveLength(5);
    });
  });
});

// ── 5. Generator Compatibility ─────────────────────────────────────────────

describe('Generator Compatibility', () => {
  it('generateSDK produces output without error', () => {
    const sdk = generateSDK(AgentResponseContract);
    expect(typeof sdk).toBe('string');
    expect(sdk.length).toBeGreaterThan(0);
  });

  it('generateSDK output contains contract name', () => {
    const sdk = generateSDK(AgentResponseContract);
    expect(sdk).toContain('AgentResponse');
  });

  it('generateSDK output contains run method', () => {
    const sdk = generateSDK(AgentResponseContract);
    expect(sdk).toContain('run(');
  });

  it('generateSDK respects options', () => {
    const sdk = generateSDK(AgentResponseContract, { className: 'AgentClient' });
    expect(sdk).toContain('AgentClient');
  });

  it('generateOpenAPI produces spec without error', () => {
    const spec = generateOpenAPI(AgentResponseContract);
    expect(spec).toBeDefined();
    expect(spec.openapi).toBe('3.1.0');
  });

  it('generateOpenAPI spec has correct info', () => {
    const spec = generateOpenAPI(AgentResponseContract);
    expect(spec.info.title).toContain('AgentResponse');
    expect(spec.info.version).toBe('2.0.0');
    expect(spec.info.description).toBeTruthy();
  });

  it('generateOpenAPI spec includes /agents/run path', () => {
    const spec = generateOpenAPI(AgentResponseContract);
    expect(spec.paths['/agents/run']).toBeDefined();
    expect(spec.paths['/agents/run'].post).toBeDefined();
  });

  it('generateOpenAPI spec has security schemes (authenticated)', () => {
    const spec = generateOpenAPI(AgentResponseContract);
    expect(spec.components.securitySchemes).toBeDefined();
  });

  it('generateOpenAPI spec has component schemas', () => {
    const spec = generateOpenAPI(AgentResponseContract);
    expect(spec.components.schemas).toBeDefined();
    expect(spec.components.schemas['AgentResponse']).toBeDefined();
  });

  it('generateOpenAPI respects server URL option', () => {
    const spec = generateOpenAPI(AgentResponseContract, {
      serverUrl: 'https://tarotscript-worker.blue-pine-edf6.workers.dev',
    });
    expect(spec.servers).toBeDefined();
    expect(spec.servers![0].url).toBe('https://tarotscript-worker.blue-pine-edf6.workers.dev');
  });
});
