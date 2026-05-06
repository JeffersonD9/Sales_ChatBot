-- ════════════════════════════════════════════════════════════════════
--  006_panel_auth.sql — Autenticación del panel de administración
--
--  Tablas:
--    panel_users       — usuarios del panel (super_admin | tenant_admin)
--    panel_sessions    — sesiones con refresh token hasheado (HMAC-SHA256)
--    panel_rate_limits — control de intentos de login por IP/usuario
--
--  Convención: UUID PKs, TIMESTAMPTZ, trigger updated_at, índices explícitos.
-- ════════════════════════════════════════════════════════════════════

-- ── Usuarios del panel ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS panel_users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(64)  UNIQUE NOT NULL,
  email         VARCHAR(256) UNIQUE NOT NULL,
  password_hash TEXT         NOT NULL,
  role          VARCHAR(32)  NOT NULL CHECK (role IN ('super_admin', 'tenant_admin')),
  tenant_id     UUID         REFERENCES tenants(id) ON DELETE SET NULL,  -- null para super_admin
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN panel_users.tenant_id IS 'null para super_admin; apunta al tenant del tenant_admin';
COMMENT ON COLUMN panel_users.role      IS 'super_admin: acceso total | tenant_admin: solo su tenant';

DROP TRIGGER IF EXISTS panel_users_updated_at ON panel_users;
CREATE TRIGGER panel_users_updated_at
  BEFORE UPDATE ON panel_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Sesiones del panel ────────────────────────────────────────────────────────
-- Nunca guardar el refresh token en claro — solo su HMAC-SHA256.
CREATE TABLE IF NOT EXISTS panel_sessions (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES panel_users(id) ON DELETE CASCADE,
  token_hash    TEXT         UNIQUE NOT NULL,  -- HMAC-SHA256(refresh_token, PANEL_REFRESH_SECRET)
  expires_at    TIMESTAMPTZ  NOT NULL,
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  ip_address    VARCHAR(45),
  user_agent    TEXT,
  revoked_at    TIMESTAMPTZ,
  revoke_reason VARCHAR(64),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN panel_sessions.token_hash    IS 'HMAC-SHA256 del refresh token — nunca el token plano';
COMMENT ON COLUMN panel_sessions.revoke_reason IS 'rotated | logout | logout_all | expired';

CREATE INDEX IF NOT EXISTS idx_panel_sessions_user_id
  ON panel_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_panel_sessions_token_hash
  ON panel_sessions(token_hash);

CREATE INDEX IF NOT EXISTS idx_panel_sessions_expires_at
  ON panel_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_panel_sessions_user_active
  ON panel_sessions(user_id, is_active) WHERE is_active = true;

-- ── Rate limiting de login ────────────────────────────────────────────────────
-- Clave: 'login:ip::{IP}' o 'login:user::{username}'
-- Se limpia periódicamente mediante cleanExpiredSessions() en service.js
CREATE TABLE IF NOT EXISTS panel_rate_limits (
  key              VARCHAR(256) PRIMARY KEY,
  count            INTEGER      NOT NULL DEFAULT 0,
  first_attempt_at TIMESTAMPTZ,
  blocked_until    TIMESTAMPTZ
);

COMMENT ON COLUMN panel_rate_limits.key IS 'login:ip::{IP} | login:user::{username}';

CREATE INDEX IF NOT EXISTS idx_panel_rate_limits_blocked
  ON panel_rate_limits(blocked_until) WHERE blocked_until IS NOT NULL;
