-- ════════════════════════════════════════════════════════════════════
--  004_billing.sql — Campos de suscripcion y cobro en tenants
--
--  Logica de ciclo:
--    - Cliente paga hoy (ej: 26 abril) → next_billing_date = 26 mayo
--    - El 26 mayo vence: subscription_status → past_due, notificacion
--    - Dias 27 y 28: recordatorios
--    - Dia 29 (3 dias de gracia): status → suspended, bot deja de responder
--    - Cuando paga: status → active, next_billing_date += 1 mes
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS plan                VARCHAR(50)  NOT NULL DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS billing_amount      INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(32)  NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS billing_cycle_start DATE,
  ADD COLUMN IF NOT EXISTS next_billing_date   DATE,
  ADD COLUMN IF NOT EXISTS grace_period_days   INTEGER      NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_payment_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at       DATE;

COMMENT ON COLUMN tenants.plan                IS 'Plan contratado: starter | pro | enterprise';
COMMENT ON COLUMN tenants.billing_amount      IS 'Precio mensual en COP (sin decimales)';
COMMENT ON COLUMN tenants.subscription_status IS 'trial | active | past_due | suspended | cancelled';
COMMENT ON COLUMN tenants.billing_cycle_start IS 'Dia del mes en que se registra el pago (ancla del ciclo)';
COMMENT ON COLUMN tenants.next_billing_date   IS 'Fecha en que vence el proximo pago';
COMMENT ON COLUMN tenants.grace_period_days   IS 'Dias de gracia antes de suspender (default 3)';
COMMENT ON COLUMN tenants.last_payment_at     IS 'Timestamp del ultimo pago registrado manualmente';
COMMENT ON COLUMN tenants.trial_ends_at       IS 'Fecha en que termina el periodo de prueba (NULL si no aplica)';

-- Indice para que el cron encuentre rapido quienes estan por vencer
CREATE INDEX IF NOT EXISTS idx_tenants_billing
  ON tenants(next_billing_date, subscription_status)
  WHERE status = 'active';
