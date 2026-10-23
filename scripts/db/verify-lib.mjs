/* The read-only verification query and how its results are judged (used by verify-project.mjs; unit-tested without a database).
   Tables that may be missing or unreadable (Supabase's migration history, auth.users, storage) are only queried inside a psql
   \if branch, after checking that they exist and are readable. PostgreSQL resolves every table named in a statement before
   running it, so a CASE around a missing table would still fail. */

/** Optional tables: [label, table]. Each is counted only if it exists and this user can read it. */
export const GUARDED = [
  ["auth_users", "auth.users"],
  ["storage_buckets", "storage.buckets"],
  ["storage_objects", "storage.objects"],
  ["migration_history", "supabase_migrations.schema_migrations"],
];

const guarded = ([label, table]) => {
  const v = label.replace(/\W/g, "_");
  return `select to_regclass('${table}') is not null as ${v}_exists, coalesce(has_table_privilege(to_regclass('${table}'), 'SELECT'), false) as ${v}_readable \\gset
\\if :${v}_readable
select '${label}', count(*)::text from ${table};
\\elif :${v}_exists
select '${label}', 'not readable';
\\else
select '${label}', 'absent';
\\endif`;
};

export const VERIFY_SQL = `
begin transaction read only;
\\pset format unaligned
\\pset tuples_only on
\\pset fieldsep '|'
select 'server', current_database() || ' · ' || split_part(version(), ' on ', 1);
select 'user_schemas', coalesce(string_agg(nspname, ', ' order by nspname), '') from pg_namespace
 where nspname not like 'pg\\_%' and nspname not in ('information_schema','public','auth','storage','extensions','graphql','graphql_public','realtime','_realtime',
  'supabase_functions','supabase_migrations','vault','pgsodium','pgsodium_masks','net','cron','pgbouncer','_analytics','pgtle','topology','tiger','tiger_data');
select 'public_relations', coalesce(string_agg(c.relname || ' (' || c.relkind || ')', ', ' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r','v','m','p','f','S');
select 'public_functions', coalesce(string_agg(p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
select 'public_types', count(*)::text from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype in ('e','d','c') and t.typrelid = 0;
select 'policies', count(*)::text from pg_policies where schemaname not in ('auth','storage','realtime','supabase_functions','vault');
${GUARDED.map(guarded).join("\n")}
select 'extensions', string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension;
rollback;
`;

export const parseRows = (stdout) => Object.fromEntries(stdout.trim().split("\n").filter((l) => l.includes("|")).map((l) => { const i = l.indexOf("|"); return [l.slice(0, i), l.slice(i + 1)]; }));

/** Judges the results: [label, value, ok] for each line. Anything not clearly empty, or that could not be checked, is not ok. */
export function assess(v, refs) {
  /* absentOk: a missing table means "none" (storage not set up, no migrations recorded); otherwise it is a STOP. */
  const count = (label, x, what, absentOk) => x === "0" ? [label, "0", true]
    : x === "absent" ? [label, `table absent (${what})`, absentOk]
    : x === "not readable" ? [label, "could not be checked (not readable by this user)", false]
    : x === undefined ? [label, "missing from the results", false]
    : [label, x, false];
  return [
    ["project reference in SUPABASE_URL", refs.url, !!refs.url],
    ["project reference in SUPABASE_DB_URL", refs.db, !!refs.db && refs.db === refs.url],
    ["database", v.server ?? "missing from the results", !!v.server],
    ["application schemas (besides public)", v.user_schemas || "none", v.user_schemas === ""],
    ["tables, views or sequences in public", v.public_relations || "none", v.public_relations === ""],
    ["functions in public (not from extensions)", v.public_functions || "none", v.public_functions === ""],
    ["custom types in public", v.public_types ?? "missing", v.public_types === "0"],
    ["row-level policies outside Supabase's own schemas", v.policies ?? "missing", v.policies === "0"],
    count("auth users", v.auth_users, "not a standard Supabase project", false),
    count("storage buckets", v.storage_buckets, "storage not set up, so none exist", true),
    count("storage files", v.storage_objects, "storage not set up, so none exist", true),
    count("migration history", v.migration_history, "no migrations recorded", true),
  ];
}
