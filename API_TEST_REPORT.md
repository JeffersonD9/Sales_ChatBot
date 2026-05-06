# API Test Report

**Date:** 2026-05-05  
**Environment:** development (local, DEMO_MODE=false, DB unreachable)  
**Server:** http://localhost:3000  

---

## Results

| Endpoint | Method | Expected | Got | Pass/Fail | Notes |
|----------|--------|----------|-----|-----------|-------|
| /health | GET | 200 | 200 | PASS | |
| /webhook/:slug (GET, tenant not found) | GET | 404 | 404 | PASS | Correct: tenant not in DB |
| /webhook/:slug (POST, bad HMAC) | POST | 401 | 401 | PASS | Correct: HMAC rejected |
| /admin/tenants (no auth) | GET | 401 | 401 | PASS | |
| /admin/tenants | GET | 200 | 500 | FAIL | DB unreachable — no graceful degradation |
| /admin/health | GET | 200 | 200 | PASS | |
| /admin/tenants (invalid body) | POST | 400 | 400 | PASS | Zod validation works |
| /admin/tenants/:slug/products (unknown slug) | GET | 404 | 200 | FAIL | Returns empty array instead of 404 |
| /admin/tenants/:slug/ai-usage (unknown slug) | GET | 404 | 200 | FAIL | Returns data for nonexistent tenant |
| /metrics | GET | 200 | 200 | PASS | |
| /demo/chat | POST | 200/403 | 403 | PASS | Disabled when DEMO_MODE=false |
| /demo/interactive | POST | 200/403 | 403 | PASS | Disabled when DEMO_MODE=false |
| /demo/reset | POST | 200/403 | 403 | PASS | Disabled when DEMO_MODE=false |
| /api/whatsapp/config (no auth) | GET | 401 | 401 | PASS | |
| /api/whatsapp/config (no auth) | PUT | 401 | 401 | PASS | |
| /api/whatsapp/config (no auth) | DELETE | 401 | 401 | PASS | |
| /panel/auth/login (missing fields) | POST | 400 | 400 | PASS | |
| /panel/auth/login (wrong creds) | POST | 401 | 400 | FAIL | Expects `username` field, not `email`; field mismatch causes 400 not 401 — API contract inconsistency |
| /panel/auth/refresh (no cookie) | POST | 401 | 401 | PASS | |
| /panel/auth/logout | POST | 200 | 200 | PASS | |
| /panel/auth/me (no auth) | GET | 401 | 401 | PASS | |
| /panel/admin/dashboard (no auth) | GET | 401 | 401 | PASS | |
| /panel/admin/tenants (no auth) | GET | 401 | 401 | PASS | |
| /nonexistent | GET | 404 | 404 | PASS | |

---

## FAILS

| Endpoint | Root Cause |
|----------|-----------|
| GET /admin/tenants | DB pool connection fails (PostgreSQL unreachable in dev without Docker). Returns unhandled 500 with no graceful error message. |
| GET /admin/tenants/:slug/products | No slug existence check — query JOINs on slug, returns empty array for nonexistent tenant instead of 404. |
| GET /admin/tenants/:slug/ai-usage | `getUsage()` does not verify slug exists before querying; returns 200 with empty/zero usage for phantom tenant. |
| POST /panel/auth/login | Auth contract uses `username` field but external docs/tests may expect `email`. Login with `{email, password}` returns 400 (missing username) rather than 401 (wrong credentials). |

---

## IMPROVEMENTS

- **Slug existence guard on admin sub-resources** — `GET /admin/tenants/:slug/products` and `/ai-usage` should verify the slug exists first and return 404. Currently, callers can't distinguish "no products" from "no tenant".
- **DB error → 503 not 500** — When the DB pool is unavailable, admin endpoints should return 503 with `{"error":"Database unavailable"}` rather than leaking a raw 500. Add a top-level error handler that maps `ECONNREFUSED`/pool errors to 503.
- **Field naming consistency** — `/panel/auth/login` uses `username`; document this clearly or accept both `username` and `email` to avoid integration confusion.
- **Rate limiting on auth endpoints** — `/panel/auth/login` and `/panel/auth/refresh` have no visible rate limiting. Brute-force protection (e.g., express-rate-limit per IP) should be added before production.
- **Metrics endpoint auth** — `GET /metrics` is publicly accessible with no authentication. If it exposes tenant counts or uptime, it should require the admin API key or be restricted by network policy.
