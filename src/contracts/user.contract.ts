/**
 * UserContract — first-party user ownership primitive.
 *
 * Required by any contract that uses ref(UserContract, 'id') for
 * ownership FK references. The canonical user entity for the
 * Stackbilt platform.
 */

import { z } from 'zod';
import { defineContract } from '../core/index.js';

export const UserStatus = z.enum(['active', 'suspended', 'deleted']);
export type UserStatus = z.infer<typeof UserStatus>;

export const UserTier = z.enum(['free', 'hobby', 'pro']);
export type UserTier = z.infer<typeof UserTier>;

export const UserContract = defineContract({
  name: 'User',
  version: '1.0.0',
  description: 'Platform user — ownership anchor for all ref() FK references',

  schema: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string().min(1).max(200),
    status: UserStatus.default('active'),
    tier: UserTier.default('free'),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),

  operations: {
    create: {
      input: z.object({
        email: z.string().email(),
        name: z.string().min(1).max(200),
        tier: UserTier.optional(),
      }),
      output: 'self' as const,
      emits: ['user.created'],
    },

    update: {
      input: z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        tier: UserTier.optional(),
      }),
      output: 'self' as const,
      emits: ['user.updated'],
    },

    suspend: {
      input: z.object({ id: z.string().uuid() }),
      output: 'self' as const,
      transition: { from: 'active', to: 'suspended' },
      emits: ['user.suspended'],
    },

    reactivate: {
      input: z.object({ id: z.string().uuid() }),
      output: 'self' as const,
      transition: { from: 'suspended', to: 'active' },
      emits: ['user.reactivated'],
    },

    delete: {
      input: z.object({ id: z.string().uuid() }),
      output: 'self' as const,
      transition: { from: ['active', 'suspended'], to: 'deleted' },
      emits: ['user.deleted'],
    },
  },

  states: {
    field: 'status',
    initial: 'active',
    transitions: {
      active:    { suspend: 'suspended', delete: 'deleted' },
      suspended: { reactivate: 'active', delete: 'deleted' },
      deleted:   {},
    },
  },

  surfaces: {
    api: {
      basePath: '/api/users',
      routes: {
        create:     { method: 'POST',   path: '/' },
        get:        { method: 'GET',    path: '/:id' },
        update:     { method: 'PUT',    path: '/:id' },
        suspend:    { method: 'POST',   path: '/:id/suspend' },
        reactivate: { method: 'POST',   path: '/:id/reactivate' },
        delete:     { method: 'DELETE', path: '/:id' },
      },
    },
    db: {
      table: 'users',
      uniqueColumns: ['email'],
      indexes: ['idx_user_email(email)', 'idx_user_status(status, tier)'],
      columnOverrides: {
        createdAt: { default: 'CURRENT_TIMESTAMP' },
        updatedAt: { default: 'CURRENT_TIMESTAMP' },
      },
    },
  },

  authority: {
    create:     { requires: 'public' },
    get:        { requires: 'owner', ownerField: 'id' },
    update:     { requires: 'owner', ownerField: 'id' },
    suspend:    { requires: 'role', roles: ['admin'] },
    reactivate: { requires: 'role', roles: ['admin'] },
    delete:     { requires: 'owner', ownerField: 'id' },
  },
});

export type User = z.infer<typeof UserContract.schema>;
export type UserInput = z.infer<typeof UserContract.operations.create.input>;
