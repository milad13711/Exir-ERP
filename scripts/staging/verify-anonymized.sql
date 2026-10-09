-- Leak check for an anonymised staging DB. Prints offending counts; every number must be 0.  Run in each staging DB:
--   psql -v ON_ERROR_STOP=1 -d <db> -f verify-anonymized.sql
\echo '--- columns that still hold real-looking Iranian mobile numbers (09 + 9 digits, not 0999...)'
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN SELECT table_name t, column_name c FROM information_schema.columns
            WHERE table_schema='public' AND data_type IN ('text','character varying') LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I ~ ''(\+98|0098|^0)9(?!99)[0-9]{9}''', r.t, r.c) INTO n;
    IF n > 0 THEN RAISE WARNING 'LEAK phone-like: %.% rows=%', r.t, r.c, n; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I ~* ''[a-z0-9._%%+-]+@(?!example\.invalid)[a-z0-9.-]+\.[a-z]{2,}''', r.t, r.c) INTO n;
    IF n > 0 THEN RAISE WARNING 'LEAK email-like: %.% rows=%', r.t, r.c, n; END IF;
  END LOOP;
END $$;
\echo '--- done: any "LEAK" warning above means anonymisation is incomplete. Fix before giving the clone to anyone.'
