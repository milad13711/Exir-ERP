# Incident runbook — suspected compromise

Principle: **contain first (minutes), rotate second (hour), investigate third.** Everything marked ⚙ is implemented in code
(admin panel page «امنیت», `POST /api/admin/security/*`, or the CLI) — no redeploy is needed to use it.

Run CLI commands on the server inside the backend container (only it reaches the control DB):

```sh
docker compose exec backend node dist/scripts/security-cli.js <command> [arg]
```

## 0. Triage (2 min)
* Where did the signal come from? Admin panel → **امنیت** → recent security events, and **لاگ‌ها → خطاها** (`service = security`).
  Event types: `LOGIN_FAILED`, `LOGIN_LOCKED`, `OTP_LOCKED`, `OTP_CAP_REACHED` (⇒ SMS pumping), `RATE_LIMITED`, `TOTP_FAILED`, `PERMISSION_DENIED`,
  `API_KEY_AUTH_FAILED`, `SESSIONS_INVALIDATED`, `API_KEY_REVOKED_ALL`, `CONFIG_INSECURE`.
* Scope: one user? one tenant? the platform (admin console / JWT secret / DB)? Pick the matching section below.

## 1. Contain

| Situation | Action |
|---|---|
| One user's session stolen / employee fired | Tenant → **disable the user** (now revokes instantly). Or ⚙ `POST /api/admin/security/tenants/:tenantId/members/:membershipId/sessions/invalidate` |
| One tenant breached (stolen OWNER phone, leaked API key) | ⚙ `POST /api/admin/security/tenants/:tenantId/sessions/invalidate` **and** ⚙ `POST /api/admin/security/tenants/:tenantId/api-keys/revoke-all` (CLI: `invalidate-tenant <slug>`, `revoke-api-keys <slug>`). Suspend the tenant from the admin panel if data exfiltration is ongoing. Ask the owner to enable 2FA (تنظیمات ← پروفایل). |
| An admin-console account suspected | ⚙ `POST /api/admin/security/admins/:adminId/sessions/invalidate` (CLI `invalidate-admin <email>`); set the admin inactive; reset password with `create-admin-user` (also bumps the session version); `reset-admin-2fa <email>` if the second factor may be compromised. |
| **Platform-wide** (JWT secret leaked, unknown admin activity, DB access) | ⚙ **Force logout everyone**: admin panel → امنیت → «خروج اجباری همه» (`POST /api/admin/security/sessions/invalidate-all`), or CLI `invalidate-all`. Takes effect within ~5 s. Then rotate the JWT secret (§2) — if the console itself is unusable, the CLI/`docker exec` path works without it. |
| SMS pumping (cost spike) | `OTP_CAP_REACHED` already blocks at `OTP_GLOBAL_DAILY_CAP`. Lower the cap, or lower `RL_OTP_REQUEST_PER_IP_15M`, restart. Block the offending IPs/ASNs at nginx/Arvan. Disable the abused public flow (module/tenant). |
| Brute force on one phone/admin | Already limited (see audit S-03/S-07). `unlock-admin <email>` clears a legitimate lock. |
| Abusive traffic / DoS | Arvan/nginx rate limits first; `RATE_LIMIT_REPORT_ONLY=false` (default) keeps the app guard on. |

## 2. Rotate secrets

Order: **JWT → API keys → DB → third-party → encryption keys.** After each rotation restart the affected container(s).

1. **JWT secret** (invalidates every user *and* admin session — the nuclear option; same effect as `invalidate-all` but also kills tokens if the old secret was leaked):
   `openssl rand -hex 32` → new `JWT_SECRET` in the server `.env` → `docker compose up -d backend`. Boot refuses weak/placeholder values.
2. **API keys:** ⚙ revoke-all per tenant (above). Tenants create new keys in تنظیمات ← API. Cached verifications expire within 30 s (restart to be immediate).
3. **Postgres:** change the `postgres` (or per-tenant, once S-14 is done) password: `ALTER ROLE postgres PASSWORD '…'`; update `TENANT_DB_ADMIN_PASSWORD` and the password inside `CONTROL_DATABASE_URL`; restart backend. Rotate `POSTGRES_PASSWORD` in `.env` for the compose-managed database.
4. **Admin console passwords:** `ADMIN_NAME=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node dist/scripts/create-admin-user.js` (≥12 chars, letters+digits; invalidates that admin's sessions and clears locks).
5. **SMTP** (`EMAIL_SMTP_*`), **platform SMS key** (`EXIR_SMS_API_KEY`), **Zarinpal merchant** (`ZARINPAL_MERCHANT_ID`), Baha24/VAPID keys: rotate at the provider, update env, restart. Tenant-owned gateway/SMS keys are the tenant's to rotate (they are encrypted at rest, masked in the UI).
6. **Webhook secrets** (HMAC for tenant webhooks): delete & recreate the subscription — a new secret is generated.
7. **Encryption keys** — `APP_SECRETS_KEY` (gateway/SMS keys, 2FA secrets), `TAX_SECRETS_KEY` (Moodian private key), `BACKUP_ENCRYPTION_KEY`: changing a key makes data encrypted under the old key unreadable. Do **not** rotate casually. If the key itself leaked: keep the old key, deploy the new key, have tenants re-enter gateway/SMS keys and re-enrol 2FA (`reset-admin-2fa` for admins). A scripted re-encryption tool is on the backlog (audit S-12 note).
8. **Licence signing key** (`apps/backend-core/keys/`, never in git): if leaked, re-issue licences with a new keypair (`npm run license:keygen`).

## 3. Investigate
* Security events (admin panel → امنیت, or `GET /api/admin/security/events?limit=500`), plus per-tenant **Activity log** (`activity_logs`, `sms_logs`).
* nginx/Arvan access logs: filter by `X-Request-Id` (returned in every error body) and the IPs in events.
* Check for persistence: new admin users (`admin_users`), new API keys (`api_keys.createdAt`), new webhooks (`webhook_subscriptions`), changed `module_settings` for `payment-gateway`/`sms-panel`, tenant users with role OWNER/ADMIN created recently.
* Preserve evidence before rotating DB passwords or restoring (copy logs + a DB snapshot).

## 4. Recover
* If data was altered/destroyed: restore with the DR procedure in `docs/disaster-recovery.md` (point-in-time = latest clean encrypted backup; remember backups hold ciphertext for gateway/SMS keys — they need the same `APP_SECRETS_KEY`).
* After restore: run `invalidate-all`, rotate JWT (§2.1), re-verify admin accounts and 2FA.
* Notify affected tenants (SMS/e-mail) if their data or keys were exposed; recommend 2FA and key regeneration.

## 5. After-action checklist
- [ ] `ADMIN_REQUIRE_TOTP=true` once every admin has enrolled.
- [ ] `APP_SECRETS_KEY` set and stored offline with the backup key.
- [ ] CSP promoted from report-only after reviewing reports.
- [ ] nginx `real_ip` configured so per-IP limits see client IPs.
- [ ] Postmortem: root cause, detection gap, new alert/limit.

## Reference: incident endpoints (SUPER_ADMIN only)
| Endpoint | Effect |
|---|---|
| `POST /api/admin/security/sessions/invalidate-all` | bump global session epoch (all tenant users + admins) |
| `POST /api/admin/security/tenants/:tenantId/sessions/invalidate` | bump tenant token version |
| `POST /api/admin/security/tenants/:tenantId/members/:membershipId/sessions/invalidate` | one member |
| `POST /api/admin/security/tenants/:tenantId/api-keys/revoke-all` | revoke every API key of the tenant |
| `POST /api/admin/security/admins/:adminId/sessions/invalidate` | one admin |
| `GET  /api/admin/security/events?limit=` | recent `service = security` log rows |
