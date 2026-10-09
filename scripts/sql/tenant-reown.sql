-- GENERATED from apps/backend-core/src/tenants/tenant-db-roles.ts (REOWN_STATEMENTS_QUERY). Do not edit.
-- usage: psql -X -d <tenant db> -v owner=<tenant role> -f scripts/sql/tenant-reown.sql   (as a superuser)
-- Re-owns every non-extension object of the connected database to :owner, then the database itself.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT stmt FROM (
  SELECT 1 AS ord, format('ALTER SCHEMA %I OWNER TO %I', n.nspname, :'owner'::text) AS stmt
    FROM pg_namespace n
   WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
     AND pg_get_userbyid(n.nspowner) <> :'owner'::text
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_namespace'::regclass AND d.objid = n.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 2, format('ALTER %s %s OWNER TO %I',
                   CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END,
                   c.oid::regclass, :'owner'::text)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r','p','v','m','S','f')
     AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
     AND pg_get_userbyid(c.relowner) <> :'owner'::text
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND (d.deptype = 'e' OR (c.relkind = 'S' AND d.deptype IN ('a','i'))))
  UNION ALL
  SELECT 3, format('ALTER %s %s OWNER TO %I', CASE t.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, t.oid::regtype, :'owner'::text)
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE t.typtype IN ('e','d') AND t.typcategory <> 'A'
     AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
     AND pg_get_userbyid(t.typowner) <> :'owner'::text
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 4, format('ALTER ROUTINE %s OWNER TO %I', p.oid::regprocedure, :'owner'::text)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
     AND pg_get_userbyid(p.proowner) <> :'owner'::text
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  UNION ALL
  SELECT 5, format('ALTER LARGE OBJECT %s OWNER TO %I', m.oid, :'owner'::text)
    FROM pg_largeobject_metadata m WHERE pg_get_userbyid(m.lomowner) <> :'owner'::text
) s ORDER BY ord, stmt
\gexec
COMMIT;
SELECT format('ALTER DATABASE %I OWNER TO %I', current_database(), :'owner') \gexec
