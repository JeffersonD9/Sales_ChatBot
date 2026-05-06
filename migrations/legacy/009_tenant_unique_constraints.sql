-- Migration 009: Unicidad en campos clave de tenants
-- name, owner_phone, owner_email, verify_token y phone_number_id
-- no pueden repetirse entre tenants distintos.
-- UNIQUE en Postgres permite múltiples NULL (owner_email, owner_phone, phone_number_id pueden ser NULL).

ALTER TABLE tenants
  ADD CONSTRAINT tenants_name_unique          UNIQUE (name),
  ADD CONSTRAINT tenants_owner_phone_unique   UNIQUE (owner_phone),
  ADD CONSTRAINT tenants_owner_email_unique   UNIQUE (owner_email),
  ADD CONSTRAINT tenants_verify_token_unique  UNIQUE (verify_token),
  ADD CONSTRAINT tenants_phone_number_id_unique UNIQUE (phone_number_id);
