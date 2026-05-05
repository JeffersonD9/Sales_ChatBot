'use strict';

const { z } = require('zod');

const createTenantSchema = z.object({
  slug:            z.string().min(3).max(64).regex(/^[a-z0-9-]+$/, 'Solo minúsculas, dígitos y guiones'),
  name:            z.string().min(2).max(256),
  wa_token:        z.string().min(10),
  phone_number_id: z.string().min(5).max(64),
  verify_token:    z.string().min(8).max(128),
  owner_phone:     z.string().regex(/^[0-9]{10,15}$/, 'Solo dígitos, 10-15 caracteres'),
  owner_email:     z.string().email().optional(),
  bot_config:      z.object({}).passthrough().optional().default({}),
});

const updateTenantSchema = z.object({
  name:            z.string().min(2).max(256).optional(),
  wa_token:        z.string().min(10).optional(),
  phone_number_id: z.string().min(5).max(64).optional(),
  verify_token:    z.string().min(8).max(128).optional(),
  owner_phone:     z.string().regex(/^[0-9]{10,15}$/, 'Solo dígitos, 10-15 caracteres').optional(),
  owner_email:     z.string().email().optional(),
  bot_config:      z.object({}).passthrough().optional(),
  status:          z.enum(['active', 'suspended', 'trial']).optional(),
  meta_live:       z.boolean().optional(),
});

const createProductSchema = z.object({
  name:        z.string().min(2).max(256),
  description: z.string().max(1000).optional().default(''),
  price:       z.number().int().positive(),
  sizes:       z.array(z.string().max(10)).optional().default([]),
  image_url:   z.union([z.string().url(), z.literal('')]).optional().default(''),
  emoji:       z.string().max(8).optional().default('🛍️'),
  category:    z.string().max(128).optional(),
});

const updateProductSchema = z.object({
  name:        z.string().min(2).max(256).optional(),
  description: z.string().max(1000).optional(),
  price:       z.number().int().positive().optional(),
  sizes:       z.array(z.string().max(10)).optional(),
  image_url:   z.union([z.string().url(), z.literal('')]).optional(),
  emoji:       z.string().max(8).optional(),
  category:    z.string().max(128).optional(),
});

module.exports = { createTenantSchema, updateTenantSchema, createProductSchema, updateProductSchema };
