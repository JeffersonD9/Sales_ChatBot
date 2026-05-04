'use strict';

// Validación Zod del bot_config antes de persistir en DB
const { z } = require('zod');

const botConfigSchema = z.object({
  greeting: z.string().min(1).max(500),
  keyword_tree: z.record(
    z.string().min(1),
    z.object({
      response:  z.string().min(1).max(1000),
      next_step: z.string().max(50).optional(),
    })
  ).default({}),
  escalation: z.object({
    trigger_keywords: z.array(z.string().min(1)).min(1),
    message:          z.string().min(1).max(500),
    notify_owner:     z.boolean().default(true),
  }),
  fallback_message: z.string().max(500).optional(),
  // Prompt personalizado para el asistente IA de este tenant.
  // Se añade al final del system prompt base como instrucciones adicionales.
  ai_system_prompt: z.string().min(1).max(2000).optional(),
});

function validateBotConfig(data) {
  const result = botConfigSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
      .join('; ');
    throw new Error(`bot_config inválido — ${issues}`);
  }
  return result.data;
}

module.exports = { botConfigSchema, validateBotConfig };
