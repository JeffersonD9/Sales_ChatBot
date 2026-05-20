-- Seed de usuario admin para entorno de desarrollo.
-- Hash Argon2id de "Admin123456!" (m=65536, t=3, p=1, len=32)
INSERT INTO panel_users (username, email, password_hash, role)
VALUES (
  'admin',
  'admin@jestsolution.tech',
  '$argon2id$v=19$m=65536,t=3,p=1$LPsi5MdcpcJDpfY1OJdbsg$b6/RgPpUIPOBxj0BymCqLPoM9xvpA+F3oVbL6/cSSJQ',
  'superadmin'
)
ON CONFLICT (username) DO NOTHING;
