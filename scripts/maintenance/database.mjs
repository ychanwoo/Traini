import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrations = new URL("../../supabase/migrations/", import.meta.url);
// Parents first. Generated columns are computed by the destination database.
export const tables = [
  "profiles",
  "traini_admin_config",
  "garmin_snapshots",
  "activities",
  "activity_training_details",
  "training_generation_requests",
  "weekly_training_reviews",
  "training_plans",
  "workouts",
  "workout_activity_matches",
  "workout_feedback_events",
  "training_week_closeouts",
  "weekly_coaching_notes",
];
const sqlString = (s) => "'" + s.replaceAll("'", "''") + "'";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const project = "kmmutfcgshellvjgpick";
function migrationFiles() {
  return readdirSync(migrations)
    .filter((n) => n.endsWith(".sql"))
    .sort();
}
function schemaVersion(files = migrationFiles()) {
  const hash = createHash("sha256");
  for (const name of files)
    hash.update(name).update(readFileSync(new URL(name, migrations)));
  return hash.digest("hex");
}
function ownerFilter(table, id) {
  const owner = sqlString(id) + "::uuid";
  if (table === "profiles") return "id=" + owner;
  if (table === "workouts")
    return (
      "plan_id in (select id from public.training_plans where user_id=" +
      owner +
      ")"
    );
  return "user_id=" + owner;
}
function linked(sql) {
  const args = [
    "db",
    "query",
    "--linked",
    "--project-ref",
    project,
    "--output",
    "json",
    "--agent",
    "no",
    "--file",
    "/dev/stdin",
  ];
  const command = process.env.TRAINI_SUPABASE_CLI;
  const result = execFileSync(
    command || "npx",
    command ? args : ["--yes", "supabase@2.121.0", ...args],
    {
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 192 * 1024 * 1024,
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  return JSON.parse(result);
}
export function snapshotSQL(owner) {
  if (!uuid.test(owner)) throw Error("Invalid owner");
  // A single SELECT shares one MVCC snapshot across all tables. Keep the JSON
  // as Postgres text end to end, including numeric precision and nested JSON.
  return (
    "select json_build_object(" +
    tables
      .map(
        (t) =>
          sqlString(t) +
          ",(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb)::text from public." +
          t +
          " r where " +
          ownerFilter(t, owner) +
          ")",
      )
      .join(",") +
    ")::text as payload,(select jsonb_agg(tablename order by tablename) from pg_catalog.pg_tables where schemaname='public') as inventory"
  );
}
export function makeSnapshot(owner, payload) {
  if (!uuid.test(owner)) throw Error("Invalid owner");
  return { version: 1, owner, schema: schemaVersion(), tables: payload };
}
export async function initializeSandbox(db, owner, files = migrationFiles()) {
  // Only substitute the platform-owned schemas/roles. All Traini migrations,
  // constraints, triggers, generated columns and policies execute unchanged.
  await db.exec(
    "create role anon; create role authenticated; create role service_role; create schema auth; create schema storage; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as 'select null::uuid'; create table storage.buckets(id text primary key,name text,public boolean); create table storage.objects(bucket_id text,name text); create function storage.foldername(text) returns text[] language sql as 'select string_to_array($1,''/'')';",
  );
  for (const n of files)
    await db.exec(readFileSync(new URL(n, migrations), "utf8"));
  await db.query("insert into auth.users(id) values ($1)", [owner]);
}
export async function verifySnapshot(snapshot, output) {
  if (
    snapshot.version !== 1 ||
    !uuid.test(snapshot.owner) ||
    Object.keys(snapshot.tables).sort().join() !== [...tables].sort().join()
  )
    throw Error("Unsupported snapshot or migration revision");
  const owner = snapshot.owner;
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    const available = migrationFiles();
    const length =
      available.findIndex(
        (_, i) => schemaVersion(available.slice(0, i + 1)) === snapshot.schema,
      ) + 1;
    if (!length) throw Error("Matching migrations required");
    await initializeSandbox(db, owner, available.slice(0, length));
    const statements = ["begin;", "set local timezone='UTC';"];
    for (const t of tables) {
      const json = snapshot.tables[t];
      if (typeof json !== "string") throw Error("Invalid snapshot payload");
      const rows = JSON.parse(json);
      if (
        !Array.isArray(rows) ||
        rows.some((r) => r === null || typeof r !== "object")
      )
        throw Error("Invalid table");
      if (
        (t === "profiles" || t === "traini_admin_config") &&
        rows.length !== 1
      )
        throw Error("Missing owner");
      const check = ownerFilter(t, owner);
      const cols = (
        await db.query(
          "select quote_ident(column_name) as col from information_schema.columns where table_schema='public' and table_name=$1 and is_generated='NEVER' order by ordinal_position",
          [t],
        )
      ).rows
        .map((r) => r.col)
        .join(",");
      // Archive input is encoded data, never SQL. Restore only into an empty
      // owner scope with the original auth identity already provisioned.
      const source =
        "convert_from(decode('" +
        Buffer.from(json).toString("hex") +
        "','hex'),'UTF8')::jsonb";
      statements.push(
        "do $$ begin if exists(select from public." +
          t +
          " where " +
          check +
          ") then raise exception 'destination contains coaching data'; end if; end $$;",
        "insert into public." +
          t +
          " (" +
          cols +
          ") select " +
          cols +
          " from jsonb_populate_recordset(null::public." +
          t +
          "," +
          source +
          ");",
        "do $$ begin if (select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public." +
          t +
          " r where " +
          check +
          ") <> (select coalesce(jsonb_agg(j order by j::text),'[]'::jsonb) from jsonb_array_elements(" +
          source +
          ") j) then raise exception 'restore mismatch'; end if; end $$;",
      );
    }
    statements.push("commit;");
    const sql = statements.join("\n");
    await db.exec(sql);
    if (output) writeFileSync(output, sql, { flag: "wx", mode: 0o600 });
  } finally {
    await db.close();
  }
}
// Only archived, terminal failures outside the quota window are disposable.
// Compare the entire live row to the verified copy before deleting it.
export function expiredRequestsSQL(snapshot, days, dryRun) {
  if (
    !uuid.test(snapshot.owner) ||
    !Number.isInteger(days) ||
    days < 30 ||
    days > 3650
  )
    throw Error("Invalid request retention");
  const archived = Buffer.from(
    snapshot.tables.training_generation_requests,
  ).toString("hex");
  const where =
    "r.user_id=" +
    sqlString(snapshot.owner) +
    "::uuid and r.state='failed' and r.finished_at < now()-interval '" +
    days +
    " days' and r.started_at < now()-interval '" +
    days +
    " days' and exists(select from jsonb_array_elements(convert_from(decode('" +
    archived +
    "','hex'),'utf8')::jsonb) j where j=to_jsonb(r)) and not exists(select from public.training_plans p where p.generation_id=r.id)" +
    " and not exists(select from public.weekly_training_reviews v where v.generation_id=r.id)";
  return dryRun
    ? "select count(*) as count from public.training_generation_requests r where " +
        where
    : "with removed as (delete from public.training_generation_requests r where " +
        where +
        " returning 1) select count(*) as count from removed";
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === "capture") {
      const owner = process.env.TRAINI_ADMIN_USER_ID;
      const result = linked(snapshotSQL(owner));
      if (result[0].inventory.join() !== [...tables].sort().join())
        throw Error("Unreviewed public table inventory");
      const snapshot = makeSnapshot(owner, JSON.parse(result[0].payload));
      process.stdout.write(JSON.stringify(snapshot));
    } else if (mode === "verify")
      await verifySnapshot(JSON.parse(readFileSync(0, "utf8")), args[0]);
    else if (mode === "prune-failed" || mode === "preview-failed") {
      const snapshot = JSON.parse(readFileSync(0, "utf8"));
      if (snapshot.owner !== process.env.TRAINI_ADMIN_USER_ID)
        throw Error("Unexpected owner");
      const rows = linked(
        expiredRequestsSQL(
          snapshot,
          Number(args[0]),
          mode === "preview-failed",
        ),
      );
      process.stdout.write(String(rows[0].count));
    } else throw Error("Unknown command");
  } catch {
    console.error(
      "Database capture or isolated restoration failed. Check CLI login, owner, migration revision and destination.",
    );
    process.exitCode = 1;
  }
}
