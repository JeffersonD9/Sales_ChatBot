import { z } from 'zod'

export const PLAN_TIERS = ['basic', 'premium'] as const
export const PLAN_ALLOCATIONS = ['shared-low', 'shared-medium', 'dedicated-db'] as const

export const planFieldsSchema = z.object({
  name: z.string().min(2).max(128),
  tier: z.enum(PLAN_TIERS),
  monthly_price: z.number().int().nonnegative(),
  currency: z
    .string()
    .trim()
    .min(3)
    .max(8)
    .transform((value) => value.toUpperCase()),
  ai_enabled: z.boolean(),
  daily_message_limit: z.number().int().nonnegative(),
  daily_ai_reply_limit: z.number().int().nonnegative(),
  daily_ai_token_limit: z.number().int().nonnegative(),
  default_allocation_strategy: z.enum(PLAN_ALLOCATIONS),
  metadata: z.record(z.unknown()).default({}),
})

export const createPlanSchema = planFieldsSchema.extend({
  code: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9_-]+$/, 'Usa letras minúsculas, números, _ o -'),
})
