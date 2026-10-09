-- Anonymise ONE restored TENANT database for the staging clone.  Run ONLY against the staging copy:
--   psql -v ON_ERROR_STOP=1 -v i_am_staging=yes -d exir_tenant_<slug> -f anonymize-tenant.sql
-- Schema-agnostic: it discovers columns by NAME (so new modules are covered without editing this file), then verifies.
-- Strategy: phones -> 0999xxxxxxx (unique, consistent within this DB); e-mails -> user<N>@example.invalid; national ids,
-- IBAN/card/account numbers, addresses, person names -> synthetic; free-text/log/session/push tables emptied; secrets removed.
\if :{?i_am_staging}
\else
  \echo 'REFUSING: pass -v i_am_staging=yes (this script destroys real data in the target database)'
  \quit
\endif
\if :i_am_staging
\else
  \quit
\endif
SET client_min_messages = warning;

BEGIN;
-- 0) guard: never on a database whose name does not look like a tenant DB
DO $$ BEGIN
  IF current_database() !~ '^exir_tenant_' THEN RAISE EXCEPTION 'not a tenant database: %', current_database(); END IF;
END $$;

-- 1) wipe volatile / free-text / secret-bearing tables (only if they exist)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['activity_logs','error_logs','notifications','push_subscriptions','webhook_deliveries','sms_messages','email_logs',
                           'otp_codes','sessions','login_attempts','attachments'] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN EXECUTE format('DELETE FROM public.%I', t); END IF;
  END LOOP;
END $$;

-- 2) secrets in module settings (gateway keys, SMS panel keys, anything key-like); encrypted ones are unreadable on staging anyway
DO $$ BEGIN
  IF to_regclass('public.module_settings') IS NOT NULL THEN
    DELETE FROM public.module_settings
     WHERE "moduleCode" IN ('sms-panel','payment-gateway','payment-gateways','voip','email','smtp')
        OR value::text ~* '(api_?key|secret|token|password|merchant|private_?key|iban|smtp)';
  END IF;
END $$;

-- 3) pseudonymise PII columns found by name
CREATE TEMP TABLE _phone_map (orig text PRIMARY KEY, fake text UNIQUE) ON COMMIT DROP;
CREATE TEMP TABLE _cols ON COMMIT DROP AS
  SELECT c.table_name::text AS t, c.column_name::text AS c,
         CASE
           WHEN c.column_name ~* '(phone|mobile|cellphone|whatsapp|fax|tel$|^tel)'          THEN 'phone'
           WHEN c.column_name ~* '(e_?mail)' AND c.column_name !~* '(enabled|cc$|template|subject)' THEN 'email'
           WHEN c.column_name ~* '(national_?(id|code)|^nationalcode|economic_?code|passport|ssn)' THEN 'nid'
           WHEN c.column_name ~* '(iban|sheba|card_?(no|number)|account_?(no|number)|bank_?account)' THEN 'bank'
           WHEN c.column_name ~* '(address|street|postal_?code|zip)'                           THEN 'addr'
           WHEN c.column_name ~* '^(first_?name|last_?name|full_?name|contact_?name|customer_?name|recipient_?name|holder_?name|employee_?name|candidate_?name|applicant_?name|client_?name|driver_?name)$' THEN 'person'
           WHEN c.column_name = 'name' AND c.table_name ~* '(user|contact|employee|candidate|customer|lead|applicant|member|client|person|driver|patient|student|supplier|vendor|referrer|ambassador)' THEN 'person'
         END AS kind
    FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
   WHERE c.table_schema = 'public' AND c.data_type IN ('text','character varying') AND c.table_name <> '_prisma_migrations';
DELETE FROM _cols WHERE kind IS NULL;

DO $$
DECLARE r record; s text; n int := 0;
BEGIN
  -- phones: one global distinct-value map => same real number maps to the same fake everywhere in this DB
  FOR r IN SELECT t, c FROM _cols WHERE kind = 'phone' LOOP
    EXECUTE format('INSERT INTO _phone_map(orig) SELECT DISTINCT %I FROM public.%I WHERE %I IS NOT NULL AND %I <> '''' ON CONFLICT DO NOTHING', r.c, r.t, r.c, r.c);
  END LOOP;
  WITH numbered AS (SELECT orig, row_number() OVER (ORDER BY md5(orig)) AS rn FROM _phone_map)
  UPDATE _phone_map m SET fake = '0999' || lpad(numbered.rn::text, 7, '0') FROM numbered WHERE numbered.orig = m.orig;
  FOR r IN SELECT t, c FROM _cols WHERE kind = 'phone' LOOP
    EXECUTE format('UPDATE public.%I x SET %I = m.fake FROM _phone_map m WHERE x.%I = m.orig', r.t, r.c, r.c);
  END LOOP;

  -- the rest: per-row synthetic values (row-number based => unique inside a table; fine for unique columns)
  FOR r IN SELECT t, c, kind FROM _cols WHERE kind <> 'phone' LOOP
    s := CASE r.kind
      WHEN 'email'  THEN 'concat(''user'', rn, ''@example.invalid'')'
      WHEN 'nid'    THEN 'lpad(rn::text, 10, ''0'')'
      WHEN 'bank'   THEN 'concat(''IR00000000000000000000'', lpad(rn::text, 4, ''0''))'
      WHEN 'addr'   THEN '''آدرس آزمایشی ''||rn'
      WHEN 'person' THEN '''نام آزمایشی ''||rn'
    END;
    EXECUTE format('UPDATE public.%I x SET %I = %s FROM (SELECT ctid AS cid, row_number() OVER () AS rn FROM public.%I) q WHERE x.ctid = q.cid AND x.%I IS NOT NULL AND x.%I <> ''''',
                   r.t, r.c, s, r.t, r.c, r.c);
    n := n + 1;
  END LOOP;
END $$;

-- 4) 2FA secrets, avatars (data URIs of real faces), signatures/stamps
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name t, column_name c FROM information_schema.columns
            WHERE table_schema='public' AND data_type IN ('text','character varying')
              AND column_name ~* '(avatar|signature|stamp|photo|logo_?data|totp|recovery)' LOOP
    EXECUTE format('UPDATE public.%I SET %I = NULL WHERE %I IS NOT NULL', r.t, r.c, r.c);
  END LOOP;
END $$;
COMMIT;
\echo 'anonymize-tenant: done. Now run verify-anonymized.sql'
