/* Rollback order and partial-failure handling (used by rollback.mjs; unit-tested without a database).

   Order: database first, then Auth.
   - Each stage event records the member who made it, and that link deliberately blocks deleting a member who has acted
     (audit protection, kept as is). Deleting an Auth user also deletes their membership, so deleting test users while the
     tables exist fails for anyone who made a move.
   - Step 1 drops every milestone 1 object in ONE database transaction: either all of it goes, or nothing changes.
   - Step 2 then deletes the marked test users through the Auth admin API, one request per user. This is NOT one
     transaction: if it stops part-way, the database is already clean and some test users remain. Re-running the step
     deletes only the users still there. */

export async function runRollback({ dropDatabaseObjects, deleteTestUsers, log = console.log }) {
  try {
    await dropDatabaseObjects();
  } catch (e) {
    log(`Step 1 failed: ${e.message}`);
    log("Nothing was changed: the database transaction was rolled back and no Auth users were touched. Fix the cause and run the rollback again.");
    return { ok: false, step: "database" };
  }
  log("Step 1 done: milestone 1 tables, functions and the app_private schema were dropped (one transaction).");
  if (!deleteTestUsers) {
    log("Step 2 skipped: no service role key in the settings file. The database is clean; the fictional test users still exist in Auth.");
    log("Remove them later with: npm run db:users -- --delete");
    return { ok: true, step: "database-only" };
  }
  try {
    const n = await deleteTestUsers();
    log(`Step 2 done: ${n} fictional test user(s) deleted from Auth.`);
    return { ok: true, step: "done" };
  } catch (e) {
    log(`Step 2 stopped part-way: ${e.message}`);
    log("The database is already clean. Some fictional test users may remain in Auth (an Auth deletion cannot be undone or grouped into one transaction).");
    log("Run again to finish: npm run db:users -- --delete (it deletes only the marked test users still present).");
    return { ok: false, step: "auth" };
  }
}
