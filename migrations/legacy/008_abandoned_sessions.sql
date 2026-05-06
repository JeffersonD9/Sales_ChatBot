-- Migration 008: campo para tracking de recuperación de carritos abandonados
-- Evita enviar el mensaje de recovery más de una vez por sesión abandonada.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS abandoned_notified_at TIMESTAMPTZ;
