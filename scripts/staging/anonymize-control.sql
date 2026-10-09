-- Anonymise the restored CONTROL database (exir_control) for the staging clone.  STAGING ONLY:
--   psql -v ON_ERROR_STOP=1 -v i_am_staging=yes -v keep_tenants="'tenant-a','tenant-b'" -d exir_control -f anonymize-control.sql
-- keep_tenants = SQL list of tenant slugs to keep (the ones you also restored + anonymised). All other tenants are deleted:
-- data minimisation is the strongest anonymisation.
\if :{?i_am_staging}
\else
  \echo 'REFUSING: pass -v i_am_staging=yes'
  \quit
\endif
\if :{?keep_tenants}
\else
  \echo 'REFUSING: pass -v keep_tenants="''slug-a'',''slug-b''"'
  \quit
\endif
SET client_min_messages = warning;
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'exir_control' THEN RAISE EXCEPTION 'not the control database: %', current_database(); END IF;
END $$;

-- 1) volatile / sensitive tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['otp_codes','sms_logs','error_logs','audit_logs','webhook_deliveries','admin_push_subscriptions',
                           'support_messages','support_tickets','internal_leads','internal_tasks','reseller_applications','api_keys','licenses'] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN EXECUTE format('DELETE FROM public.%I', t); END IF;
  END LOOP;
END $$;
DELETE FROM public.security_state WHERE true;

-- 2) data minimisation: keep only the listed tenants (+ their memberships via FK cascade where defined)
DELETE FROM public.tenant_memberships WHERE "tenantId" IN (SELECT id FROM public.tenants WHERE slug NOT IN (:keep_tenants));
DELETE FROM public.tenants WHERE slug NOT IN (:keep_tenants);
DELETE FROM public.global_users g WHERE NOT EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m."globalUserId" = g.id);

-- 3) people: unique fake phones, names, no avatars, no 2FA
WITH n AS (SELECT id, row_number() OVER (ORDER BY id) rn FROM public.global_users)
UPDATE public.global_users g SET phone = '0999' || lpad(n.rn::text, 7, '0'), name = 'کاربر آزمایشی ' || n.rn,
       "avatarUrl" = NULL, "totpSecretEnc" = NULL, "totpEnabledAt" = NULL, "totpLastStep" = NULL, "recoveryCodeHashes" = '{}', "lastLoginAt" = NULL
  FROM n WHERE g.id = n.id;

-- 4) platform staff: unusable passwords + no 2FA (create staging staff with the create-admin-user CLI afterwards)
WITH n AS (SELECT id, row_number() OVER (ORDER BY id) rn FROM public.admin_users)
UPDATE public.admin_users a SET email = 'staff' || n.rn || '@example.invalid', name = 'کارشناس آزمایشی ' || n.rn,
       "passwordHash" = '!disabled-by-anonymizer', "totpSecretEnc" = NULL, "totpEnabledAt" = NULL, "totpLastStep" = NULL,
       "recoveryCodeHashes" = '{}', "failedLoginCount" = 0, "lockedUntil" = NULL, "mustChangePassword" = true, "lastLoginAt" = NULL, "tokenVersion" = "tokenVersion" + 1
  FROM n WHERE a.id = n.id;

-- 5) tenants: webhook targets neutralised; token versions bumped so every production-issued JWT is dead on staging
UPDATE public.tenants SET "tokenVersion" = "tokenVersion" + 1000;
DO $$ BEGIN
  IF to_regclass('public.webhook_subscriptions') IS NOT NULL THEN
    UPDATE public.webhook_subscriptions SET url = 'https://example.invalid/hook', secret = 'x';
  END IF;
END $$;
COMMIT;
\echo 'anonymize-control: done. Rotate JWT_SECRET/APP_SECRETS_KEY on staging (new values!), then run verify-anonymized.sql'
