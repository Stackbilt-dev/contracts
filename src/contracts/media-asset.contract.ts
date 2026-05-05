import { z } from 'zod';
import { defineContract } from '@stackbilt/contracts';

const AssetStatus = z.enum([
  'draft',
  'prompt_captured',
  'generated',
  'normalized',
  'available',
  'deprecated',
]);

const AssetRole = z.enum([
  'menu_theme',
  'ambient_bed',
  'featured_song',
  'stinger',
  'narration',
]);

const ProviderMetadataStatus = z.enum(['pending_backfill', 'complete']);

const ProviderMetadata = z.object({
  provider: z.string().min(1).nullable(),
  modelVersion: z.string().min(1).nullable(),
  projectId: z.string().min(1).nullable(),
  generationDate: z.string().datetime().nullable(),
  sourceUrl: z.string().url().nullable(),
  metadataStatus: ProviderMetadataStatus.default('pending_backfill'),
});

/**
 * MediaAssetContract (OSS-safe primitive)
 *
 * Generic generated-media lifecycle and provenance contract:
 * prompt captured -> generated -> normalized -> available.
 */
export const MediaAssetContract = defineContract({
  name: 'MediaAsset',
  version: '1.0.0',
  description: 'Generated media lifecycle with provider provenance attestation',

  schema: z.object({
    id: z.string().uuid(),
    assetKey: z.string().min(1), // stable key, e.g. shadows_in_gold
    title: z.string().min(1).max(200),
    role: AssetRole,
    status: AssetStatus.default('draft'),
    sourcePath: z.string().min(1).nullable(),
    normalizedPath: z.string().min(1).nullable(),
    promptSpec: z.string().min(1).nullable(),
    contentSpec: z.string().min(1).nullable(),
    notes: z.string().max(5000).nullable(),
    providerMetadata: ProviderMetadata,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),

  operations: {
    registerDraft: {
      input: z.object({
        assetKey: z.string().min(1),
        title: z.string().min(1).max(200),
        role: AssetRole,
      }),
      output: 'self' as const,
      emits: ['media_asset.registered'],
    },

    capturePrompt: {
      input: z.object({
        id: z.string().uuid(),
        promptSpec: z.string().min(1),
        contentSpec: z.string().min(1).optional(),
        notes: z.string().max(5000).optional(),
      }),
      output: 'self' as const,
      transition: { from: ['draft', 'prompt_captured'], to: 'prompt_captured' },
      emits: ['media_asset.prompt_captured'],
    },

    attachGeneratedFile: {
      input: z.object({
        id: z.string().uuid(),
        sourcePath: z.string().min(1),
      }),
      output: 'self' as const,
      transition: { from: ['prompt_captured', 'generated'], to: 'generated' },
      emits: ['media_asset.generated_attached'],
    },

    attachNormalizedFile: {
      input: z.object({
        id: z.string().uuid(),
        normalizedPath: z.string().min(1),
      }),
      output: 'self' as const,
      transition: { from: ['generated', 'normalized'], to: 'normalized' },
      emits: ['media_asset.normalized_attached'],
    },

    recordProviderMetadata: {
      input: z.object({
        id: z.string().uuid(),
        provider: z.string().min(1),
        modelVersion: z.string().min(1),
        projectId: z.string().min(1),
        generationDate: z.string().datetime(),
        sourceUrl: z.string().url(),
      }),
      output: 'self' as const,
      emits: ['media_asset.metadata_recorded'],
    },

    publishAvailable: {
      input: z.object({
        id: z.string().uuid(),
      }),
      output: 'self' as const,
      transition: { from: 'normalized', to: 'available' },
      emits: ['media_asset.available'],
    },

    deprecate: {
      input: z.object({
        id: z.string().uuid(),
        reason: z.string().min(1).max(500),
      }),
      output: 'self' as const,
      transition: { from: ['draft', 'prompt_captured', 'generated', 'normalized', 'available'], to: 'deprecated' },
      emits: ['media_asset.deprecated'],
    },
  },

  states: {
    field: 'status',
    initial: 'draft',
    transitions: {
      draft: {
        capturePrompt: 'prompt_captured',
        deprecate: 'deprecated',
      },
      prompt_captured: {
        attachGeneratedFile: 'generated',
        deprecate: 'deprecated',
      },
      generated: {
        attachNormalizedFile: 'normalized',
        deprecate: 'deprecated',
      },
      normalized: {
        publishAvailable: 'available',
        deprecate: 'deprecated',
      },
      available: {
        deprecate: 'deprecated',
      },
      deprecated: {},
    },
  },

  surfaces: {
    api: {
      basePath: '/api/media-assets',
      routes: {
        registerDraft: { method: 'POST', path: '/' },
        capturePrompt: { method: 'POST', path: '/:id/prompt' },
        attachGeneratedFile: { method: 'POST', path: '/:id/generated' },
        attachNormalizedFile: { method: 'POST', path: '/:id/normalized' },
        recordProviderMetadata: { method: 'POST', path: '/:id/provenance/provider' },
        publishAvailable: { method: 'POST', path: '/:id/publish' },
        deprecate: { method: 'POST', path: '/:id/deprecate' },
      },
    },
    db: {
      table: 'media_assets',
      indexes: [
        'idx_media_asset_status(status, updated_at)',
        'idx_media_asset_key(asset_key)',
      ],
      columnOverrides: {
        createdAt: { default: 'CURRENT_TIMESTAMP' },
        updatedAt: { default: 'CURRENT_TIMESTAMP' },
      },
    },
  },

  authority: {
    registerDraft: { requires: 'role', roles: ['content_ops', 'admin'] },
    capturePrompt: { requires: 'role', roles: ['content_ops', 'admin'] },
    attachGeneratedFile: { requires: 'role', roles: ['content_ops', 'admin'] },
    attachNormalizedFile: { requires: 'role', roles: ['content_ops', 'admin'] },
    recordProviderMetadata: { requires: 'role', roles: ['content_ops', 'admin'] },
    publishAvailable: { requires: 'role', roles: ['content_ops', 'admin'] },
    deprecate: { requires: 'role', roles: ['content_ops', 'admin'] },
  },

  invariants: [
    {
      name: 'available_requires_normalized_path_and_metadata',
      description: 'Available asset must have normalized path and complete provider metadata',
      check: (entity: unknown) => {
        const e = entity as {
          status?: string;
          normalizedPath?: string | null;
          providerMetadata?: {
            provider?: string | null;
            modelVersion?: string | null;
            projectId?: string | null;
            generationDate?: string | null;
            sourceUrl?: string | null;
            metadataStatus?: string | null;
          };
        };

        if (e.status === 'available') {
          if (!e.normalizedPath) return 'Available asset requires normalizedPath';
          if (!e.providerMetadata) return 'Available asset requires providerMetadata';
          if (!e.providerMetadata.provider) return 'Available asset requires providerMetadata.provider';
          if (!e.providerMetadata.modelVersion) return 'Available asset requires providerMetadata.modelVersion';
          if (!e.providerMetadata.projectId) return 'Available asset requires providerMetadata.projectId';
          if (!e.providerMetadata.generationDate) return 'Available asset requires providerMetadata.generationDate';
          if (!e.providerMetadata.sourceUrl) return 'Available asset requires providerMetadata.sourceUrl';
          if (e.providerMetadata.metadataStatus !== 'complete') return 'Available asset requires providerMetadata.metadataStatus=complete';
        }
        return true;
      },
      appliesTo: ['publishAvailable'],
    },
  ],
});
