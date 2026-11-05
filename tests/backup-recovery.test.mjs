import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  initializeSandbox,
  snapshotSQL,
  makeSnapshot,
  verifySnapshot,
  expiredRequestsSQL,
  tables,
} from "../scripts/maintenance/database.mjs";

test("one owner snapshot restores through production migrations and rejects missing parents or changed values", async () => {
  const owner = "10000000-0000-4000-8000-000000000001";
  const other = "10000000-0000-4000-8000-000000000002";
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await initializeSandbox(db, owner);
    await db.query("insert into auth.users values ($1)", [other]);
    await db.exec(`insert into profiles(id,race_name) values ('${owner}','Synthetic runner''s race'),('${other}','Excluded');
      insert into traini_admin_config(user_id) values ('${owner}');
      insert into training_plans(user_id,starts_on,ends_on,target_distance_km,recovery_label) values ('${owner}','2025-01-06','2025-01-12',31.25,'test');
      insert into workouts(plan_id,scheduled_on,kind,status,title,purpose) select id,starts_on,'easy','scheduled','easy','test' from training_plans;
      insert into training_generation_requests(user_id,starts_on,state,input_revision,started_at,finished_at)
      select '${owner}','2025-01-06',s,'test',now()-interval '120 days',now()-interval '119 days' from unnest(array['failed','failed','completed']) s;`);
    const [captured] = (await db.query(snapshotSQL(owner))).rows;
    assert.deepEqual(captured.inventory, [...tables].sort());
    const snap = makeSnapshot(owner, JSON.parse(captured.payload));
    assert.equal(JSON.parse(snap.tables.profiles).length, 1);
    assert.equal(JSON.parse(snap.tables.workouts).length, 1);
    await verifySnapshot(snap);
    const broken = structuredClone(snap);
    broken.tables.training_plans = "[]";
    await assert.rejects(verifySnapshot(broken));
    const changed = structuredClone(snap);
    changed.tables.profiles = JSON.stringify([
      { ...JSON.parse(changed.tables.profiles)[0], unknown_column: "new" },
    ]);
    await assert.rejects(verifySnapshot(changed), /restore mismatch/);
    const unknown = structuredClone(snap);
    delete unknown.tables.weekly_coaching_notes;
    await assert.rejects(verifySnapshot(unknown));
    // Eligible rows changed after backup, active requests, and referenced rows survive.
    await db.exec(
      "update training_generation_requests set failure_code='changed' where id=(select id from training_generation_requests where state='failed' limit 1)",
    );
    assert.equal(
      Number(
        (await db.query(expiredRequestsSQL(snap, 90, true))).rows[0].count,
      ),
      1,
    );
    await db.exec(
      "update training_plans set generation_id=(select id from training_generation_requests where state='failed' and failure_code is null limit 1)",
    );
    assert.equal(
      Number(
        (await db.query(expiredRequestsSQL(snap, 90, false))).rows[0].count,
      ),
      0,
    );
    await db.exec("update training_plans set generation_id=null");
    assert.equal(
      Number(
        (await db.query(expiredRequestsSQL(snap, 90, false))).rows[0].count,
      ),
      1,
    );
    assert.equal(
      Number(
        (await db.query(expiredRequestsSQL(snap, 90, false))).rows[0].count,
      ),
      0,
    );
  } finally {
    await db.close();
  }
});
