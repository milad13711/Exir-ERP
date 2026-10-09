# Safe staging clone for penetration testing

A pentest must never run against production tenants. This describes two ways to build a staging target. **Prefer A.**

| | A. Synthetic (preferred) | B. Anonymised clone |
|---|---|---|
| Data | created from scratch with fake data | restored from a backup then scrubbed |
| Risk of real data leaking | none | residual (free text, JSON, files) - needs verification |
| Realism (volume/shape) | low-medium | high |
| Effort | 0.5 day (+ seed script) | 1 day first time |

Use B only to add *realistic volume* for a couple of tenants; keep the number of cloned tenants to the minimum (2-3). Data minimisation
(`keep_tenants`) is the strongest anonymisation.

## 0. Ground rules for any staging environment
1. **Separate server** (a small cloud VM, 4 vCPU / 8 GB) and **separate domain** (`stg-*.<domain>`). Never on the production host, never reachable with production DNS/cookies/secrets.
2. **Every secret is new**: `JWT_SECRET`, `APP_SECRETS_KEY`, `TAX_SECRETS_KEY`, `POSTGRES_PASSWORD`, `BACKUP_ENCRYPTION_KEY`, `INTERNAL_ALERT_TOKEN`. Generating new values on purpose also kills every production-issued session/API-key on the clone.
3. **All outbound integrations blanked/sandboxed**: `EXIR_SMS_API_KEY=` and `EXIR_SMS_SENDER_LINE=` empty (no SMS is sent; with `OTP_DEV_ECHO=true` the OTP is returned in the response so testers can log in), `ZARINPAL_MERCHANT_ID=` empty or the gateway's sandbox merchant, `BAHA24_API_KEY=`, `VAPID_*=`, `BACKUP_S3_*=` empty, `MONITOR_ALERT_PHONE=`/`ON_PREM_OWNER_PHONE=` set to a *test* number or blank, `WEBHOOK_ALLOW_PRIVATE_NETWORKS` unset.
4. Access restricted: allow-list the tester IPs at the cloud firewall and/or HTTP basic-auth in front of nginx. Remove all production SSH keys; create a separate admin user.
5. Time-boxed: create for the engagement, **destroy afterwards** (VM + DB + backups + the tester accounts).
6. Same code version as production (or the exact commit you want tested). Record the commit in the engagement notes.
7. Mark clearly in the UI/title (`STAGING`) so nobody mistakes it for production; deploy a `robots.txt` Disallow.

## A. Synthetic data (preferred)
1. Fresh VM -> `scripts/deploy.sh` style install (`docker compose -f docker-compose.on-premise.yml up -d --build`) with a staging `.env` (section 0). The entrypoint runs migrations and the seed. Set `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` (random, kept in your password manager) for the first platform admin.
2. Create **tenant A and tenant B** through the real signup flow (`/signup`) so provisioning is exercised. Use obviously fake business names (`Staging Alpha`, `Staging Beta`) and test phone numbers `0999000000x` (OTP echoed because no SMS provider is configured).
3. In each tenant create roles: OWNER, ADMIN, MEMBER with limited custom role, MEMBER with no permissions, one DISABLED user (see the account table in `pentest-brief.md`).
4. Seed canary data in tenant B (`CANARY-B-001` contact, invoice, attachment, form) and a few realistic records in A.
5. Create public artefacts (form, proposal, booking page, contract link, invoice-pay link, event, shop with products).
6. Create an API key per tenant; create platform staff SUPPORT and SUPER_ADMIN (`create-admin-user` CLI) and enable TOTP on the SUPER_ADMIN; hand the secret to the vendor.

## B. Anonymised clone of real backups
Uses the existing tooling only: encrypted backups + `scripts/restore-control.sh` / `scripts/restore-tenant.sh` + the anonymisers in `scripts/staging/`.

Files (all refuse to run without `-v i_am_staging=yes` and a matching database name):
- `scripts/staging/anonymize-control.sql` - keeps only listed tenants, rewrites users/staff, deletes logs/OTPs/tickets/leads/API keys/licenses, invalidates tokens, neutralises webhooks.
- `scripts/staging/anonymize-tenant.sql` - discovers PII columns **by name** (phone/mobile -> `0999xxxxxxx` unique and consistent, e-mail -> `userN@example.invalid`, national id, IBAN/card, address, person names), wipes activity/error/notification/push/attachment tables, removes gateway/SMS/secret-looking `module_settings`, clears avatars/signatures/stamps/2FA columns.
- `scripts/staging/verify-anonymized.sql` - scans every text column for real-looking Iranian mobile numbers and e-mail addresses; every `LEAK` warning must be zero.

### Script outline (run on the STAGING VM only; steps shown, adapt paths)
```bash
#!/usr/bin/env bash
# build-staging.sh  - OUTLINE. Run on the staging VM (hostname contains "stg"), never on production.
set -euo pipefail
[[ "$(hostname -s)" == *stg* ]] || { echo "not a staging host"; exit 1; }
cd /opt/exir-staging                                   # git clone of the repo at the commit under test
KEEP="'tenant-a','tenant-b'"                           # slugs to clone (2-3 max)
export BACKUP_ENCRYPTION_KEY=...                       # PRODUCTION backup key, read-only use, from password manager; not stored on disk
# 1) fetch the latest encrypted files from S3 with a READ-ONLY key (see docs/drill/full-rebuild-drill.md for the rclone env pattern)
#    -> backups/_control/<date>.sql.gz.enc  and  backups/<slug>/<date>.sql.gz.enc  for each kept slug
# 2) start only postgres of the STAGING stack (new POSTGRES_PASSWORD):  docker compose -f docker-compose.on-premise.yml up -d postgres
# 3) restore control, then tenants (the same scripts as disaster recovery)
./scripts/restore-control.sh --docker --file backups/_control/$CONTROL_FILE --yes
for s in tenant-a tenant-b; do
  db="exir_tenant_${s//-/_}"
  ./scripts/restore-tenant.sh --docker --file "backups/$s/$(ls backups/$s | sort | tail -1)" --db "$db" --yes
done
# 4) ANONYMISE (control first: it deletes the other tenants), then each tenant, then verify
PSQL="docker compose -f docker-compose.on-premise.yml exec -T postgres psql -X -q -U postgres -v ON_ERROR_STOP=1"
$PSQL -d exir_control -v i_am_staging=yes -v keep_tenants="$KEEP" < scripts/staging/anonymize-control.sql
for s in tenant-a tenant-b; do
  db="exir_tenant_${s//-/_}"
  $PSQL -d "$db" -v i_am_staging=yes < scripts/staging/anonymize-tenant.sql
  $PSQL -d "$db" < scripts/staging/verify-anonymized.sql 2>&1 | tee /tmp/verify-$s.txt
  ! grep -q LEAK /tmp/verify-$s.txt || { echo "LEAK in $s - STOP, do not hand this clone out"; exit 1; }
done
# 5) DELETE the encrypted backups and the production key from this VM; unset BACKUP_ENCRYPTION_KEY
shred -u backups/*/*.enc 2>/dev/null || rm -f backups/*/*.enc; unset BACKUP_ENCRYPTION_KEY
# 6) start the stack with the staging .env (all-new secrets, integrations blanked) and create the tester accounts (section A.3-A.6)
docker compose -f docker-compose.on-premise.yml up -d --build
```
Run `psql ... < anonymize-tenant.sql` **inside the staging postgres only**. The restore scripts are dry-run by default; the `--yes` above only touches staging databases.

### What the SQL does NOT cover (manual review before handing over)
- JSON columns (`module_settings.value`, custom-field JSON, form submissions `data`, activity payloads): the verify script scans text columns only. Spot-check with
  `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND data_type IN ('json','jsonb');` and either truncate those tables or extend the scrubber.
- Free-text fields (notes, descriptions, messages, ticket bodies, comments) may contain names/phones typed by hand. For high assurance **truncate** the notes/messages tables of the cloned tenants.
- Uploaded files (attachments hold links/data-URIs): the table is emptied; if files live in object storage/volumes they are not copied by the backup anyway.
- Tenant `name`/`slug` and business-level data (product names, prices, company names) are left as is - the `keep_tenants` list must only contain tenants whose owner agreed or that belong to you.
- Customer legal consent: cloning real customer data to a third-party tester may need a contractual basis even after anonymisation. Prefer A.

### After the clone is up (both paths)
1. Log in with every test account; confirm OTP echo works and **no SMS was sent** (SMS log empty / provider key blank).
2. Verify isolation controls yourself with one quick IDOR attempt A -> B so you know the test target behaves like production.
3. Run `scripts/security/self-scan.sh https://stg-app.<domain> --i-own-this` for a baseline (headers/deps/secrets).
4. Share credentials via a password manager; give the vendor the tester IP allow-list instructions.
5. After the engagement: destroy the VM and DNS records, rotate anything shared, record the retest evidence.
