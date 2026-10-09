# Per-tenant Postgres roles (audit finding S-14)

**Problem.** Every tenant database used to be opened with the same cluster superuser (`TENANT_DB_ADMIN_USER`). One injection or
tenant-resolution bug anywhere in the API could therefore read or write *every* tenant's data (and `exir_control`).

**Goal.** Least privilege: each tenant has its own `LOGIN` role that owns and can connect to **only** its database. The privileged
account is used only for provisioning, migrations, backups/restores and the rollout tooling.

## Design

| Piece | Where |
|---|---|
| Columns `tenants.dbUser`, `tenants.dbPasswordEnc` (nullable, additive) | control migration `20261009100000_tenant_db_roles` |
| Password sealing (AES-256-GCM, `APP_SECRETS_KEY`, AAD = `tenantdb:<dbName>`, fail closed) | `src/prisma/tenant-db-credentials.ts` (uses `src/security/app-secrets.ts`) |
| Credential selection + client cache | `src/prisma/tenant-prisma.service.ts` |
| Role/SQL helpers, re-own, verification | `src/tenants/tenant-db-roles.ts` |
| New-tenant provisioning, drop | `TenantDbAdminService.createDatabaseWithRole / dropDatabase`, `TenantsService.createTenant` |
| Existing-tenant rollout CLI | `src/scripts/tenant-db-roles.ts` (`npm run tenant-db-roles -- ...` or `node dist/scripts/tenant-db-roles.js ...`) |
| Post-restore ownership fix | `scripts/restore-db.sh` + `scripts/sql/tenant-reown.sql` |

* **Backward compatible.** A tenant row with `dbUser`/`dbPasswordEnc` NULL keeps using the legacy shared credentials. Rollout is one tenant at a time; rollback is one command.
* **Credential selection.** Most of the ~65 call sites call `forTenant({dbHost, dbPort, dbName})`, so `TenantPrismaService` keeps an in-memory registry `dbName -> credential` loaded from the control plane at boot and every `TENANT_DB_CRED_REFRESH_MS` (default 15 000 ms). Credentials present on the row passed in win over the registry. The cache is keyed by `(dbName, credential fingerprint)`: apply / rotate / rollback produce a **fresh client**, and the previous client is disconnected after a 30 s grace period.
* **Fail closed.** If a tenant has role credentials that cannot be decrypted (key missing/rotated), requests for that tenant get `503` — they do **not** silently fall back to the superuser. Fix with the right key or `rollback`. Storing a new password without `APP_SECRETS_KEY` throws; plaintext is never stored. A sealed value that is not `enc1:`-prefixed is refused.
* **Secrets hygiene.** `ControlPrismaService` is configured with a global `omit: { tenant: { dbPasswordEnc: true } }`, so no admin/API response built from a `Tenant` row can contain it (only the registry loader selects it explicitly). The password is sent to Postgres as a pre-computed **SCRAM-SHA-256 verifier** (never in a statement, so `log_statement`/`pg_stat_activity` never show it). The CLI prints no passwords, URLs or Prisma query excerpts.
* **Migrations stay privileged.** `applyTenantSchema` (called at tenant creation and on every container start by `migrate-all-tenants`) runs `prisma migrate deploy` with the admin account (DDL, `CREATE EXTENSION pgcrypto`), then **re-owns everything it created to the tenant role** (`reownTenantDatabase`; only objects not yet owned by the role are touched, so it is cheap and idempotent). Chosen over "run migrations as the tenant role" because it does not break if a future migration needs a superuser-only statement, and it also repairs objects created by manual admin migrations or restores.

### Configuration

| Env | Default | Meaning |
|---|---|---|
| `TENANT_DB_ISOLATION` | `auto` | New tenants: `auto` = own role if `APP_SECRETS_KEY` is configured (else legacy + warning); `required` = refuse to provision without it; `off` = always legacy (e.g. on-prem installs whose admin account is not a superuser) |
| `TENANT_DB_ROLE_CONN_LIMIT` | `40` | `CONNECTION LIMIT` of each tenant role (5–500). Keep `limit × tenants` below Postgres `max_connections` headroom; Prisma pool size per tenant is unchanged |
| `TENANT_DB_CRED_REFRESH_MS` | `15000` | How often a running backend re-reads credentials from the control plane (`0` = only at boot) |
| `APP_SECRETS_KEY` | – | Already required by S-12; **must be set before `apply`/`rotate`**. Losing it means the sealed passwords are unreadable — back it up like `JWT_SECRET`; recovery = `rotate`-less path: `ALTER ROLE ... PASSWORD` manually + re-seal, or `rollback` |
| `TENANT_DB_ADMIN_USER/PASSWORD` | as before | The privileged account. **Must be a superuser** (it creates roles, sets database owners, re-owns objects) and match `^[a-z][a-z0-9_]{2,62}$` for `apply` (needed for a guaranteed rollback) |

## Exact SQL

Role (name `exir_t_<slug sanitised, ≤40>_<first 8 hex of sha256(slug)>`, deterministic, ≤63 chars; `<verifier>` is a client-computed SCRAM-SHA-256 verifier of a 64-char random password):

```sql
CREATE ROLE "exir_t_acme_1a2b3c4d" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT 40 PASSWORD '<SCRAM-SHA-256$4096:salt$StoredKey:ServerKey>';
```

New tenant (connected to `postgres`):

```sql
CREATE DATABASE "exir_tenant_acme" ENCODING 'UTF8' OWNER "exir_t_acme_1a2b3c4d";
REVOKE ALL ON DATABASE "exir_tenant_acme" FROM PUBLIC;            -- removes CONNECT + TEMP for everybody else
GRANT CONNECT, TEMPORARY ON DATABASE "exir_tenant_acme" TO "exir_t_acme_1a2b3c4d";
-- then: prisma migrate deploy (privileged) ; re-own (below)
```

Existing tenant (`apply`): the same `CREATE/ALTER ROLE`, the same `REVOKE/GRANT`, then in the tenant DB (privileged), **one statement per object not yet owned by the role** (`REOWN_STATEMENTS_QUERY` in `tenant-db-roles.ts`, mirrored in `scripts/sql/tenant-reown.sql`), in one transaction with `lock_timeout = 10s`:

```sql
ALTER SCHEMA public OWNER TO "role";  ALTER TABLE ... OWNER TO "role";  ALTER SEQUENCE ... ;  ALTER VIEW ...;
ALTER TYPE ... (enums) ; ALTER DOMAIN ...; ALTER ROUTINE ...; ALTER LARGE OBJECT ...;
ALTER DATABASE "exir_tenant_acme" OWNER TO "role";
```

Extension members (pgcrypto) and sequences linked to a column (they follow the table) are skipped. We deliberately do **not** use `REASSIGN OWNED BY postgres`: it also reassigns every other database owned by that role cluster-wide.

Cluster hardening (`harden-cluster`, once): `REVOKE ALL ON DATABASE "exir_control" FROM PUBLIC;` and the same for every legacy tenant DB (and optionally `postgres`, `template1` with `--include-maintenance`). **Verified safe for the app**: the control plane and every legacy tenant connect as the superuser, which ignores `CONNECT` privileges. *Check before running in prod* that no other non-superuser login (monitoring exporter, backup user, BI) relies on PUBLIC `CONNECT` — `\l+` shows `=Tc/postgres` entries; grant them explicitly first.

Without `harden-cluster`, a tenant role could still *connect* to other databases that keep the default PUBLIC `CONNECT` (it would see no tables — it owns nothing and has no grants there — but the isolation check would fail). `apply` therefore refuses to run until the other databases are closed.

## What `apply` verifies (as the new role, before flipping the control row)

role attributes (no super/createdb/createrole/replication/bypassrls, no memberships) · all objects owned by the role · DB owned by role and PUBLIC has no CONNECT · full DML on every `public` table · connect + `CREATE TABLE`/`INSERT`/`SELECT` on a canary (in a transaction that is rolled back) + read of an app table · **SQLSTATE 42501** when connecting to `exir_control` and to other tenant DBs on the cluster (first 25) · cannot `CREATE ROLE` / `CREATE DATABASE`. (Bad-password failures `28P01` are never mistaken for a pass.)

Any failure: ownership handed back to the admin, PUBLIC grants restored, role dropped if `apply` created it, control row left (or reset) at NULL. The tenant stays on legacy credentials.

## Staged rollout runbook (production)

Run from the server, inside the backend container. `T="docker compose exec backend node dist/scripts/tenant-db-roles.js"` (exact compose file/service per your deploy; the script needs `CONTROL_DATABASE_URL`, `TENANT_DB_ADMIN_*`, `APP_SECRETS_KEY`, `pg_dump` — all present in the image).

0. **Preconditions.** Deploy this change (control migration is applied by the entrypoint; nothing changes behaviourally yet). Confirm `APP_SECRETS_KEY` is set and backed up. Confirm `pg_hba.conf` lets the backend's network reach the cluster with `scram-sha-256` for non-`postgres` users (not only `postgres`). Take a fresh full backup (`BackupDr` run-now) and note `max_connections`.
1. **Plan** (read-only): `$T plan` — per tenant: role name, #objects to re-own, current owner.
2. **Harden the cluster** (one time, instant, reversible with `GRANT CONNECT ... TO PUBLIC`): `$T harden-cluster` (dry run) then `$T harden-cluster --yes`. Verify the app still works (login, a public page).
3. **Pilot: tenant `local`.** `$T apply --tenant local --yes` (takes `pg_dump` safety copy into `./tenant-db-roles-dumps/`, mode 0600, **unencrypted — move/delete it after the rollout**). Expect all `PASS` lines. Then `$T verify --tenant local`, and within ~15 s log in as that tenant and exercise create/edit/report/cron-driven pages. Watch `docker compose logs backend | grep -i "permission denied\|42501\|credentials"`.
4. **One low-traffic tenant**, same commands. Soak ≥ 24 h (includes the nightly crons, backup run, a container restart so `migrate-all-tenants` runs with the role present).
5. **The rest**, one by one or in small batches: `for s in $(...slugs...); do $T apply --tenant $s --yes || break; done`. Then `$T verify` — expect `0 FAILED, 0 legacy`.
6. **Close out.** Delete safety dumps. Run `$T harden-cluster --include-maintenance --yes` only if no tool needs PUBLIC on `postgres`/`template1`. Remove the old "superuser for tenant DBs" warning from `boot-checks.ts` when all tenants are isolated (optional).

Ongoing: `$T verify` (cron-able; exit code 1 on any failure); `$T rotate --tenant <slug> --yes` (ALTER ROLE → verify new password → store sealed → on any failure the old password is restored). During rotation *new* DB connections of already-running backends use the old password until their next credential refresh (≤ 15 s; established pool connections keep working) — rotate in low traffic.

Verification queries (privileged):

```sql
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolconnlimit FROM pg_roles WHERE rolname LIKE 'exir_t_%';
SELECT datname, pg_get_userbyid(datdba) AS owner, datacl FROM pg_database WHERE datname LIKE 'exir_%';   -- no "=Tc" (PUBLIC) entries
-- inside a tenant DB: objects NOT owned by the tenant role (should be empty)
SELECT c.oid::regclass, pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','S','v','m') AND pg_get_userbyid(c.relowner) <> 'exir_t_<...>';
```

### Rollback

* One tenant: `$T rollback --tenant <slug> --yes` — clears `dbUser`/`dbPasswordEnc`; the tenant uses legacy credentials again within ~15 s (running backends swap pools). The role and object ownership are left as they are (the superuser can use them), so you can re-`apply`/`rotate` later.
* Whole feature: `UPDATE tenants SET "dbUser"=NULL, "dbPasswordEnc"=NULL;` in the control DB (or `rollback` per tenant) and/or `TENANT_DB_ISOLATION=off` for new tenants. Old code ignores the new columns.
* If the safety copy is needed: `scripts/restore-tenant.sh`-style restore of the `.sql.gz` (see below).

## Backups, restores, migrations

* `src/backup-dr` and `src/settings/backup.service.ts` connect with the privileged account and dump with `--no-owner --no-privileges` — unchanged, and they work on role-owned databases (restore *tests* create throwaway `exir_restore_check_*` DBs as the admin and drop them).
* **Restore into an existing tenant DB** (`scripts/restore-db.sh`): the script records the DB owner before restoring; if it is a tenant role (`exir_t_*`) it runs `scripts/sql/tenant-reown.sql` afterwards, so objects end up owned by the role again (printed as `ownership: objects handed back to tenant role ...`). Tested against a local cluster. Restoring into a **new** database name creates it admin-owned (legacy) — run `$T apply --tenant <slug> --yes` afterwards to give it a role. Manual equivalent: `psql -d <db> -v owner=<role> -f scripts/sql/tenant-reown.sql`.
* **Migrations**: `migrate-all-tenants` (container start) migrates privileged and re-owns. A manual `prisma migrate deploy` with the admin URL leaves new objects admin-owned until the next start (or `psql ... tenant-reown.sql`); the app would get `permission denied` on them in that window.

## Residual risk / notes

* The backend process still holds the admin credentials (provisioning, migrations, backups) and `exir_control` access, so a full RCE in the API still reaches everything; S-14 removes the *SQL-injection / tenant-resolution-bug* blast radius, not RCE. Moving provisioning/migrations to a separate privileged job would be the next step.
* A tenant role is the DB owner, so it can `GRANT`, create objects/extensions that are *trusted* (pgcrypto) and `DROP` its own tables — acceptable (it is that tenant's data); it cannot touch other databases or cluster objects.
* `postgres`/`template1` stay connectable by PUBLIC unless `--include-maintenance` is used: a tenant role can list `pg_database`/`pg_roles` (names only).
* Superuser-ownership of `pgcrypto` and the `_prisma_migrations` table: the table is re-owned; the extension stays admin-owned (members are skipped), its functions are executable by PUBLIC.

## Tests

* Unit: `src/tenants/tenant-db-roles.spec.ts` (identifier validation, SQL construction, role naming, SCRAM verifier, SQL-file sync), `src/prisma/tenant-prisma.service.spec.ts` (credential selection, cache switching, encryption fail-closed, no plaintext, AAD binding).
* Opt-in integration (`src/tenants/tenant-db-roles.integration.spec.ts`, localhost only, throwaway `exir_*_it_*` DBs/roles): `TENANT_ROLES_IT=1 TENANT_ROLES_IT_PORT=<port> TENANT_DB_ADMIN_USER=postgres TENANT_DB_ADMIN_PASSWORD=... npx vitest run tenant-db-roles.integration` — full tenant migration set + app queries as the role; cannot connect to another tenant DB / the control DB; cannot `CREATE ROLE/DATABASE/ALTER ROLE`; legacy conversion; idempotent re-own; admin-owned late objects fixed by re-own; apply-rollback; `pg_dump --no-owner` + restore + re-own; `tenant-reown.sql` via psql. Use a throwaway cluster with `scram-sha-256` auth (a `trust` cluster cannot prove password handling).
