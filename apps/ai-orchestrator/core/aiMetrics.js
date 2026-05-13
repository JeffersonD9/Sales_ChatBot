'use strict';

/**
 * core/ai/aiMetrics.js — Contador de llamadas IA por tenant por mes
 *
 * Almacenamiento: Redis con clave `ai_calls:{tenantSlug}:{YYYY-MM}`
 * TTL: 90 días (para conservar 3 meses de histórico)
 *
 * Si Redis está down, las métricas se omiten silenciosamente —
 * el bot sigue funcionando sin interrupción.
 *
 * Costo de referencia Claude Haiku (2025):
 *   Input cacheado:  $0.08 / MTok  → ~$0.000000080 / token
 *   Output:          $4.00 / MTok  → ~$0.000004000 / token
 *   Estimado medio por llamada (~500 tokens cache + 200 output):
 *   ≈ $0.000040 + $0.000800 ≈ $0.00085 / llamada
 */

const { redis } = require('../../../packages/platform-data');
const { logger }   = require('@whatsapp-saas/logger');

const { getRedis } = redis;

const TTL_SECONDS  = 90 * 24 * 60 * 60; // 90 días
const COST_PER_CALL = 0.00085;           // USD estimado por llamada

function _monthKey(tenantSlug) {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  return `ai_calls:${tenantSlug}:${month}`;
}

/**
 * Incrementa el contador de llamadas IA para el tenant actual.
 * Fire-and-forget: no bloquea el flujo principal.
 * @param {string} tenantSlug
 */
async function increment(tenantSlug) {
  const redis = getRedis();
  if (!redis) return;
  try {
    const key = _monthKey(tenantSlug);
    await redis.incr(key);
    await redis.expire(key, TTL_SECONDS);
  } catch (err) {
    logger.warn({ tenantSlug, err: err.message }, '[AIMetrics] Error incrementando contador');
  }
}

/**
 * Retorna el uso de IA del tenant para el mes actual.
 * @param {string} tenantSlug
 * @returns {Promise<{ calls_this_month: number, month: string, estimated_cost_usd: string }>}
 */
async function getUsage(tenantSlug) {
  const month = new Date().toISOString().slice(0, 7);
  const redis = getRedis();

  if (!redis) {
    return { calls_this_month: 0, month, estimated_cost_usd: '0.00', note: 'Redis no disponible' };
  }

  try {
    const key   = `ai_calls:${tenantSlug}:${month}`;
    const count = parseInt(await redis.get(key) || '0', 10);
    return {
      calls_this_month:   count,
      month,
      estimated_cost_usd: (count * COST_PER_CALL).toFixed(4),
    };
  } catch (err) {
    logger.warn({ tenantSlug, err: err.message }, '[AIMetrics] Error leyendo contador');
    return { calls_this_month: 0, month, estimated_cost_usd: '0.00' };
  }
}

module.exports = { increment, getUsage };
