import { z } from 'zod';
import { defineContract } from '../core/index.js';

const AccessState = z.enum(['preview', 'full', 'expired', 'revoked']);
const VerificationSource = z.enum(['offline_preview', 'provider_api', 'manual_override']);

/**
 * EntitlementContract (OSS-safe primitive)
 *
 * Generic access lifecycle contract:
 * - any subject can begin in preview
 * - credential verification promotes to full
 * - system/admin can expire/revoke/reset
 */
export const EntitlementContract = defineContract({
  name: 'Entitlement',
  version: '1.0.0',
  description: 'Generic preview/full access entitlement with credential verification lifecycle',

  schema: z.object({
    id: z.string().uuid(),
    productKey: z.string().min(1).max(100),
    accessState: AccessState.default('preview'),
    subjectId: z.string().min(1).nullable(),
    subjectEmail: z.string().email().nullable(),
    credentialRef: z.string().min(1).nullable(),
    deviceId: z.string().min(1).nullable(),
    verificationSource: VerificationSource.default('offline_preview'),
    grantedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    revokedAt: z.string().datetime().nullable(),
    revokedReason: z.string().max(500).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),

  operations: {
    beginPreview: {
      input: z.object({
        productKey: z.string().min(1).max(100),
        deviceId: z.string().min(1).optional(),
      }),
      output: 'self' as const,
      emits: ['entitlement.preview_started'],
    },

    verifyCredential: {
      input: z.object({
        id: z.string().uuid(),
        credentialRef: z.string().min(1),
        subjectEmail: z.string().email().optional(),
      }),
      output: 'self' as const,
      transition: { from: ['preview', 'expired'], to: 'full' },
      emits: ['entitlement.verified'],
    },

    expire: {
      input: z.object({
        id: z.string().uuid(),
      }),
      output: 'self' as const,
      transition: { from: 'full', to: 'expired' },
      emits: ['entitlement.expired'],
    },

    revoke: {
      input: z.object({
        id: z.string().uuid(),
        reason: z.string().min(1).max(500),
      }),
      output: 'self' as const,
      transition: { from: ['preview', 'full', 'expired'], to: 'revoked' },
      emits: ['entitlement.revoked'],
    },

    resetToPreview: {
      input: z.object({
        id: z.string().uuid(),
      }),
      output: 'self' as const,
      transition: { from: ['full', 'expired', 'revoked'], to: 'preview' },
      emits: ['entitlement.reset_preview'],
    },
  },

  states: {
    field: 'accessState',
    initial: 'preview',
    transitions: {
      preview: {
        verifyCredential: 'full',
        revoke: 'revoked',
      },
      full: {
        expire: 'expired',
        revoke: 'revoked',
        resetToPreview: 'preview',
      },
      expired: {
        verifyCredential: 'full',
        revoke: 'revoked',
        resetToPreview: 'preview',
      },
      revoked: {
        resetToPreview: 'preview',
      },
    },
  },

  surfaces: {
    api: {
      basePath: '/api/entitlements',
      routes: {
        beginPreview: { method: 'POST', path: '/preview' },
        verifyCredential: { method: 'POST', path: '/:id/verify' },
        expire: { method: 'POST', path: '/:id/expire' },
        revoke: { method: 'POST', path: '/:id/revoke' },
        resetToPreview: { method: 'POST', path: '/:id/reset' },
      },
    },
    db: {
      table: 'entitlements',
      indexes: [
        'idx_entitlement_product_state(product_key, access_state)',
        'idx_entitlement_credential(credential_ref, access_state)',
      ],
      columnOverrides: {
        createdAt: { default: 'CURRENT_TIMESTAMP' },
        updatedAt: { default: 'CURRENT_TIMESTAMP' },
      },
    },
  },

  authority: {
    beginPreview: { requires: 'public' },
    verifyCredential: { requires: 'public' },
    expire: { requires: 'role', roles: ['system', 'admin'] },
    revoke: { requires: 'role', roles: ['admin'] },
    resetToPreview: { requires: 'role', roles: ['admin'] },
  },

  invariants: [
    {
      name: 'full_requires_credential_and_grant_time',
      description: 'Full access must be backed by a credentialRef and grantedAt timestamp',
      check: (entity: unknown) => {
        const e = entity as { accessState?: string; credentialRef?: string | null; grantedAt?: string | null };
        if (e.accessState === 'full' && (!e.credentialRef || !e.grantedAt)) {
          return 'Full access requires credentialRef and grantedAt';
        }
        return true;
      },
      appliesTo: ['verifyCredential', 'resetToPreview'],
    },
    {
      name: 'revoked_requires_reason',
      description: 'Revoked access must include a reason',
      check: (entity: unknown) => {
        const e = entity as { accessState?: string; revokedReason?: string | null };
        if (e.accessState === 'revoked' && !e.revokedReason) {
          return 'Revoked access requires revokedReason';
        }
        return true;
      },
      appliesTo: ['revoke'],
    },
  ],
});
