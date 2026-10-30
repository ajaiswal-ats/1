import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createProject, snapshot } from "./fake-supabase.mjs";

let p, staff, clientUser, otherStaff, clientId, otherClientId, submissionId, setId, requirements;
const rubric = (approved = false) => ({ id: "synthetic-staff-rules", version: 1, approved,
  gates: [{ id: "G1", label: "Synthetic essential" }],
  criteria: [{ id: "C1", label: "Synthetic skill", importance: "Critical", weight: 3, max: 3, included: true }],
});
const inputs = { gates: [{ id: "G1", result: "Unknown" }], criteria: [{ id: "C1", status: "rated", rating: 2 }] };
const questions = [{ id: "Q1", text: "Describe a synthetic result.", use: "scored", answerPoints: ["A result with evidence."] }];
async function fixture(approved = false, roleId = null) {
  // Each hosted assessment owns one explicitly mapped submission. Use a new fictional person/submission per test.
  const next = (await p.db.query(`insert into public.people(client_id,ref,name) values($1,gen_random_uuid()::text,'Synthetic reviewed candidate') returning id`, [clientId])).rows[0].id;
  const sub = (await p.db.query(`insert into public.submissions(client_id,ref,role_id,person_id,stage,shared_on,publication)
    select client_id,gen_random_uuid()::text,coalesce($3,role_id),$2,'To review',current_date,'published' from public.submissions where id=$1 returning id`, [submissionId, next, roleId])).rows[0].id;
  return (await p.db.query(`insert into app_private.scoring_assessments(client_id, submission_id, rubric, original_inputs, inputs, prepared_by, screening_questions)
    values($1,$2,$3,$4,$4,'Synthetic local assessment',$5) returning id`, [clientId, sub, rubric(approved), inputs, questions])).rows[0].id;
}
const review = () => ({ decision: "forward", decisionReason: "Reviewed the synthetic evidence and gaps.", whyShared: "Reviewed synthetic experience relevant to this role.",
  strengths: ["Synthetic strength."], pointsToClarify: ["Synthetic point to confirm."], setId,
  evidence: requirements.map((q) => ({ requirementId: q.id, status: "supported", evidence: "Verified synthetic evidence.", source: "Recruiter verification" })),
  screening: [{ id: "Q1", question: questions[0].text, answer: "", rating: null, quote: "", reason: "" }], changes: [],
});
const save = (id, state = inputs, r = review(), revision = 1, user = staff) => asUser(p.db, user,
  "select public.recruiter_save_review($1,$2,$3,$4,$5) as revision", [id, revision, state, r, "Reviewed evidence against the synthetic role."]);
const share = (id, revision = 2, user = staff) => asUser(p.db, user, "select public.recruiter_share_summary($1,$2) as id", [id, revision]);

beforeAll(async () => {
  p = await createProject({ m6: true });
  await p.db.exec(fs.readFileSync(new URL("../../supabase/migrations/20261030120000_m7_recruiter_scoring.sql", import.meta.url), "utf8"));
  staff = p.ids["portal-test-no-membership@example.com"]; clientUser = p.ids["portal-test-harbor@example.com"]; otherStaff = p.ids["portal-test-harbor-inactive@example.com"];
  const clients = (await p.db.query("select id, ref from public.clients")).rows;
  clientId = clients.find((c) => c.ref === "harbor").id; otherClientId = clients.find((c) => c.ref === "northwind").id;
  await p.db.query("insert into app_private.recruiters(user_id,display_name) values($1,'Synthetic recruiter'),($2,'Other recruiter')", [staff, otherStaff]);
  await p.db.query("insert into app_private.recruiter_clients(user_id,client_id) values($1,$2),($3,$4)", [staff, clientId, otherStaff, otherClientId]);
  const sub = (await p.db.query(`select s.id, rs.id as set_id from public.submissions s join public.role_requirement_sets rs on rs.role_id=s.role_id and rs.status='agreed'
    where s.client_id=$1 and s.publication='published' order by s.id limit 1`, [clientId])).rows[0];
  submissionId = sub.id; setId = sub.set_id;
  requirements = (await p.db.query("select id from public.role_requirements where set_id=$1", [setId])).rows;
});
afterAll(async () => { await p?.db.close(); });

// Include existing published/paused content so a rejected save cannot silently pause it,
// and a rejected share cannot create a replacement package or alter any client records.
async function revisionFixture(operation) {
  const id = await fixture(true);
  await save(id);
  await share(id);
  if (operation === "share") await save(id, inputs, review(), 2);
  return { id, revision: operation === "save" ? 2 : 3 };
}
async function revisionSnapshot(id) {
  return {
    clientRecords: await snapshot(p.db),
    assessment: (await p.db.query("select * from app_private.scoring_assessments where id=$1", [id])).rows,
    history: (await p.db.query("select * from app_private.scoring_review_history where assessment_id=$1 order by id", [id])).rows,
  };
}
for (const operation of ["save", "share"]) describe(`${operation} expected-revision protection`, () => {
  it.each([
    { label: "NULL", revision: null, code: "PT409" },
    { label: "missing", missing: true, code: "42883" },
    { label: "stale", revision: 1, code: "PT409" },
    { label: "future", revision: 999, code: "PT409" },
  ])("rejects $label revisions without changing assessment, history or client records", async ({ revision, missing, code }) => {
    const { id } = await revisionFixture(operation), before = await revisionSnapshot(id);
    const request = () => missing
      // No default argument: omission must fail SQL function resolution, never become an unchecked revision.
      ? operation === "save"
        ? asUser(p.db, staff, "select public.recruiter_save_review(p_id => $1, p_inputs => $2, p_review => $3, p_reason => $4)",
          [id, inputs, review(), "Reviewed the synthetic evidence."])
        : asUser(p.db, staff, "select public.recruiter_share_summary(p_id => $1)", [id])
      : operation === "save" ? save(id, inputs, review(), revision) : share(id, revision);
    await expect(request()).rejects.toMatchObject({ code });
    expect(await revisionSnapshot(id)).toEqual(before);
  });
  it("accepts the correct revision when all other requirements are met", async () => {
    const { id, revision } = await revisionFixture(operation);
    if (operation === "save") {
      expect((await save(id, inputs, review(), revision)).rows[0].revision).toBe(revision + 1);
      expect((await p.db.query("select revision, reviewed_revision from app_private.scoring_assessments where id=$1", [id])).rows[0])
        .toEqual({ revision: revision + 1, reviewed_revision: revision + 1 });
    } else {
      const packageId = (await share(id, revision)).rows[0].id;
      expect((await asUser(p.db, clientUser, "select state, why_shared from public.submission_packages where id=$1", [packageId])).rows[0])
        .toEqual({ state: "published", why_shared: review().whyShared });
    }
    const history = (await p.db.query("select kind, revision, actor_user_id from app_private.scoring_review_history where assessment_id=$1 order by id desc limit 1", [id])).rows[0];
    expect(history).toEqual({ kind: operation === "save" ? "review" : "share", revision: operation === "save" ? revision + 1 : revision, actor_user_id: staff });
  });
});

describe("separate recruiter access and private assessments", () => {
  it("applies on the real portal schema; clients and signed-out callers cannot read private tables or staff RPCs", async () => {
    const id = await fixture();
    for (const user of [clientUser, null]) {
      await expect(asUser(p.db, user, "select * from app_private.scoring_assessments")).rejects.toThrow(/permission denied/);
      await expect(asUser(p.db, user, "select public.recruiter_assessment($1)", [id])).rejects.toThrow(/recruiter_access_required|permission denied/);
    }
    expect((await asUser(p.db, clientUser, "select public.recruiter_account() as account")).rows[0].account).toBe(null);
  });
  it("limits staff to explicitly assigned clients and checks revocation on every request", async () => {
    const id = await fixture();
    expect((await asUser(p.db, staff, "select public.recruiter_assessment($1) as a", [id])).rows[0].a.id).toBe(id);
    await expect(asUser(p.db, otherStaff, "select public.recruiter_assessment($1)", [id])).rejects.toThrow(/recruiter_access_required/);
    await expect(save(id, inputs, review(), 1, otherStaff)).rejects.toThrow(/recruiter_access_required/);
    await p.db.query("update app_private.recruiters set active=false where user_id=$1", [staff]);
    await expect(save(id)).rejects.toThrow(/recruiter_access_required/);
    await p.db.query("update app_private.recruiters set active=true where user_id=$1", [staff]);
  });
  it("requires current revisions, preserves originals, attributes changes to the signed-in staff member", async () => {
    const id = await fixture(), changed = structuredClone(inputs); changed.criteria[0].rating = 1;
    const r = review(); r.changes = [{ id: "C1", source: "cv", evidence: "A checked synthetic quote.", reason: "Only the lower anchor is evidenced." }];
    expect((await save(id, changed, r)).rows[0].revision).toBe(2);
    await expect(save(id)).rejects.toThrow(/assessment_changed_reload/);
    const stored = (await p.db.query("select original_inputs, inputs from app_private.scoring_assessments where id=$1", [id])).rows[0];
    expect(stored.original_inputs).toEqual(inputs); expect(stored.inputs.criteria[0].rating).toBe(1);
    expect((await p.db.query("select actor_user_id from app_private.scoring_review_history where assessment_id=$1", [id])).rows[0].actor_user_id).toBe(staff);
    await expect(p.db.query("update app_private.scoring_assessments set rubric=$2 where id=$1", [id, rubric(true)])).rejects.toThrow(/immutable/);
    await expect(p.db.query("delete from app_private.scoring_review_history where assessment_id=$1", [id])).rejects.toThrow(/append.only/);
  });
  it("rejects manipulated IDs, missing evidence and unsupported rating values", async () => {
    const id = await fixture();
    const changed = structuredClone(inputs); changed.criteria[0].rating = 1;
    await expect(save(id, changed)).rejects.toThrow(/each_correction_needs_evidence/);
    changed.criteria[0].rating = 4;
    await expect(save(id, changed)).rejects.toThrow(/invalid_rating/);
    changed.criteria[0].id = "NOT-A-CRITERION";
    await expect(save(id, changed)).rejects.toThrow(/invalid_criterion_id/);
  });
  it("call evidence can lower a CV rating but cannot raise it or turn Unknown into a rating", async () => {
    const id = await fixture(), changed = structuredClone(inputs), r = review();
    changed.criteria[0].rating = 3; r.changes = [{ id: "C1", source: "screening", evidence: "Synthetic call evidence.", reason: "Synthetic change reason." }];
    await expect(save(id, changed, r)).rejects.toThrow(/screening_cannot_raise_cv_rating/);
    changed.criteria[0].rating = 1; await save(id, changed, r);
  });
  it("requires a verbatim answer quote for each screening rating; facts cannot be scored", async () => {
    const id = await fixture(), r = review();
    r.screening[0] = { ...r.screening[0], answer: "I completed two synthetic projects.", rating: 4, quote: "not in the answer", reason: "Covers most answer points." };
    await expect(save(id, inputs, r)).rejects.toThrow(/screening_rating_needs_answer_quote/);
    r.screening[0].quote = "two synthetic projects"; await save(id, inputs, r);
    r.screening[0].question = "A different question";
    await expect(save(id, inputs, r, 2)).rejects.toThrow(/screening_question_changed/);
  });
});

describe("explicit sharing of reviewed client summaries", () => {
  it("review saves do not publish; test rules block sharing on the server", async () => {
    const id = await fixture(), before = (await p.db.query("select count(*)::int as n from public.submission_packages")).rows[0].n;
    await save(id);
    expect((await p.db.query("select count(*)::int as n from public.submission_packages")).rows[0].n).toBe(before);
    await expect(share(id)).rejects.toThrow(/scoring_rules_await_approval/);
  });
  it("requires explicit evidence for every agreed requirement; failed essentials block forwarding", async () => {
    const id = await fixture(true), r = review(); r.evidence.pop();
    await save(id, inputs, r); await expect(share(id)).rejects.toThrow(/map_every_agreed_requirement/);
    const failed = structuredClone(inputs); failed.gates[0].result = "Fail";
    r.changes = [{ id: "G1", source: "cv", evidence: "Verified synthetic mismatch.", reason: "Does not meet the written essential." }];
    await expect(save(id, failed, r, 2)).rejects.toThrow(/essential_not_met/);
  });
  it("shares only reviewed client fields, with author history, and rejects duplicate or stale sharing", async () => {
    const id = await fixture(true); await save(id);
    const published = (await share(id)).rows[0].id;
    const pkg = (await asUser(p.db, clientUser, "select * from public.submission_packages where id=$1", [published])).rows[0];
    expect(pkg.why_shared).toBe(review().whyShared); expect(pkg.state).toBe("published");
    expect(pkg.strengths).toEqual(review().strengths);
    expect(JSON.stringify(pkg)).not.toMatch(/decisionReason|screening|rubric|rating|reviewer/);
    const ev = (await asUser(p.db, clientUser, "select * from public.requirement_evidence where package_id=$1", [published])).rows;
    expect(ev).toHaveLength(requirements.length);
    await expect(share(id)).rejects.toThrow(/summary_already_shared/);
    await save(id, inputs, review(), 2);
    await expect(share(id, 2)).rejects.toThrow(/assessment_changed_reload/);
    expect((await asUser(p.db, clientUser, "select * from public.submission_packages where id=$1", [published])).rows).toEqual([]);
    expect((await p.db.query("select state from public.submission_packages where id=$1", [published])).rows[0].state).toBe("paused");
  });
});

const clientFacts = [{ label: "Notice period", value: "Two fictional weeks" }];
async function contentFixture({ facts = [], screening = false, withPackage = true, roleId = null, requirementSet = setId, requirementRows = requirements } = {}) {
  const id = await fixture(true, roleId), r = review();
  r.setId = requirementSet;
  r.evidence = requirementRows.map((q) => ({ requirementId: q.id, status: "supported", evidence: "Reviewed client-safe evidence.", source: "Synthetic verification" }));
  r.decisionReason = "PRIVATE decision reason, never client content.";
  r.screening[0] = { ...r.screening[0], answer: "PRIVATE raw screening answer.", rating: 4, quote: "raw screening answer", reason: "PRIVATE rating notes." };
  await save(id, inputs, r);
  let packageId = null;
  if (withPackage) {
    packageId = (await p.db.query(`insert into public.submission_packages(client_id,submission_id,role_id,requirement_set_id,version,why_shared,key_facts)
      select a.client_id,s.id,s.role_id,$2,1,'Previously reviewed client summary.',$3
      from app_private.scoring_assessments a join public.submissions s on s.id=a.submission_id where a.id=$1 returning id`, [id, requirementSet, facts])).rows[0].id;
    await p.db.query(`insert into public.requirement_evidence(client_id,package_id,requirement_set_id,requirement_id,status,evidence,source_label)
      select client_id,$1,set_id,id,'supported','Previously reviewed evidence.','Synthetic source' from public.role_requirements where set_id=$2`, [packageId, requirementSet]);
    if (screening) await p.db.query(`insert into public.screening_summaries(client_id,package_id,requirement_set_id,call_on,duration_minutes,recruiter_name,summary,notes_for_client,key_moments)
      values($1,$2,$3,current_date-1,20,'Fictional recruiter','Reviewed client screening summary.','Reviewed client-safe note.','[{"minute":2,"label":"Reviewed topic"}]')`, [clientId, packageId, requirementSet]);
    await p.db.query("select app_private.publish_package($1)", [packageId]);
  }
  return { id, packageId };
}
async function visibleContent(user, packageId) {
  return {
    packages: (await asUser(p.db, user, "select * from public.submission_packages where id=$1", [packageId])).rows,
    screening: (await asUser(p.db, user, "select * from public.screening_summaries where package_id=$1", [packageId])).rows,
  };
}
describe("replacement protects existing reviewed client content", () => {
  it.each([
    { label: "key facts", facts: clientFacts, screening: false },
    { label: "screening summary", facts: [], screening: true },
    { label: "both", facts: clientFacts, screening: true },
  ])("refuses to replace $label without confirmation of continued validity", async (options) => {
    const { id, packageId } = await contentFixture(options);
    const before = await revisionSnapshot(id), visibleBefore = await visibleContent(clientUser, packageId);
    expect(visibleBefore.packages).toHaveLength(1);
    expect(visibleBefore.screening).toHaveLength(options.screening ? 1 : 0);
    await expect(share(id)).rejects.toMatchObject({ code: "PT409", message: "existing_client_content_needs_review" });
    expect(await revisionSnapshot(id)).toEqual(before);
    expect(await visibleContent(clientUser, packageId)).toEqual(visibleBefore);
  });
  it.each([true, false])("shares safely when there is no protected content (existing empty package: %s)", async (withPackage) => {
    const { id, packageId } = await contentFixture({ withPackage });
    const published = (await share(id)).rows[0].id;
    const visible = await visibleContent(clientUser, published);
    expect(visible.packages).toHaveLength(1); expect(visible.packages[0].key_facts).toEqual([]);
    expect(visible.screening).toEqual([]);
    expect(JSON.stringify(visible)).not.toMatch(/PRIVATE|decisionReason|rating|screeningQuestions|rubric/);
    expect(await visibleContent(p.ids["portal-test-northwind@example.com"], published)).toEqual({ packages: [], screening: [] });
    await expect(asUser(p.db, clientUser, "select public.recruiter_assessment($1)", [id])).rejects.toThrow(/recruiter_access_required/);
    if (packageId) expect((await p.db.query("select state, key_facts from public.submission_packages where id=$1", [packageId])).rows[0])
      .toEqual({ state: "superseded", key_facts: [] });
  });
  it("does not carry forward content from obsolete requirements, even after the new requirements are reviewed", async () => {
    const roleId = (await p.db.query("insert into public.roles(client_id,ref,title,status,opened_on) values($1,gen_random_uuid()::text,'Synthetic isolated role','Open',current_date) returning id", [clientId])).rows[0].id;
    async function newSet(version) {
      const set = (await p.db.query("insert into public.role_requirement_sets(client_id,role_id,version,label) values($1,$2,$3,'Synthetic requirements') returning id", [clientId, roleId, version])).rows[0].id;
      const rows = (await p.db.query("insert into public.role_requirements(client_id,set_id,position,text,tier) values($1,$2,1,'Synthetic requirement','must') returning id", [clientId, set])).rows;
      await p.db.query("select app_private.agree_requirement_set($1,current_date)", [set]);
      return { set, rows };
    }
    const old = await newSet(1);
    const { id, packageId } = await contentFixture({ facts: clientFacts, screening: true, roleId, requirementSet: old.set, requirementRows: old.rows });
    const current = await newSet(2), r = review();
    r.setId = current.set; r.evidence = current.rows.map(q => ({ requirementId: q.id, status: "supported", evidence: "Reviewed new requirements.", source: "Synthetic verification" }));
    await save(id, inputs, r, 2);
    const before = await revisionSnapshot(id), visibleBefore = await visibleContent(clientUser, packageId);
    await expect(share(id, 3)).rejects.toMatchObject({ code: "PT409", message: "existing_client_content_needs_review" });
    expect(await revisionSnapshot(id)).toEqual(before);
    expect(await visibleContent(clientUser, packageId)).toEqual(visibleBefore);
  });
  it("does not disclose existing content to an unassigned recruiter", async () => {
    const { id } = await contentFixture({ facts: clientFacts, screening: true }), before = await revisionSnapshot(id);
    await expect(share(id, 2, otherStaff)).rejects.toThrow(/recruiter_access_required/);
    expect(await revisionSnapshot(id)).toEqual(before);
  });
  it("does not discard protected content from a paused package", async () => {
    const { id, packageId } = await contentFixture({ facts: clientFacts, screening: true });
    await p.db.query("update public.submission_packages set state='paused' where id=$1", [packageId]);
    const before = await revisionSnapshot(id), visibleBefore = await visibleContent(clientUser, packageId);
    await expect(share(id)).rejects.toThrow(/existing_client_content_needs_review/);
    expect(await revisionSnapshot(id)).toEqual(before);
    expect(await visibleContent(clientUser, packageId)).toEqual(visibleBefore);
  });
  it("continues to support M3-only databases without the optional screening table", async () => {
    const plain = await createProject();
    try {
      await plain.db.exec(fs.readFileSync(new URL("../../supabase/migrations/20261030120000_m7_recruiter_scoring.sql", import.meta.url), "utf8"));
      const user = plain.ids["portal-test-no-membership@example.com"];
      await plain.db.query("insert into app_private.recruiters(user_id,display_name) values($1,'Synthetic reviewer')", [user]);
      await plain.db.query("insert into app_private.recruiter_clients(user_id,client_id) values($1,$2)", [user, clientId]);
      const person = (await plain.db.query("insert into public.people(client_id,ref,name) values($1,gen_random_uuid()::text,'Synthetic candidate') returning id", [clientId])).rows[0].id;
      const sub = (await plain.db.query(`insert into public.submissions(client_id,ref,role_id,person_id,stage,shared_on,publication)
        select client_id,gen_random_uuid()::text,role_id,$2,'To review',current_date,'published' from public.submissions where id=$1 returning id`, [submissionId, person])).rows[0].id;
      const id = (await plain.db.query(`insert into app_private.scoring_assessments(client_id,submission_id,rubric,original_inputs,inputs,screening_questions,prepared_by)
        values($1,$2,$3,$4,$4,$5,'Synthetic import') returning id`, [clientId, sub, rubric(true), inputs, questions])).rows[0].id;
      await asUser(plain.db, user, "select public.recruiter_save_review($1,1,$2,$3,'Reviewed fictional evidence.')", [id, inputs, review()]);
      const pkg = (await asUser(plain.db, user, "select public.recruiter_share_summary($1,2) as id", [id])).rows[0].id;
      // Exercise the existing-empty-package path too, where the optional table check runs.
      await asUser(plain.db, user, "select public.recruiter_save_review($1,2,$2,$3,'Reviewed fictional evidence.')", [id, inputs, review()]);
      await asUser(plain.db, user, "select public.recruiter_share_summary($1,3)", [id]);
      expect((await plain.db.query("select state from public.submission_packages where id=$1", [pkg])).rows[0].state).toBe("superseded");
    } finally { await plain.db.close(); }
  });
  it("rolls back replacement and keeps client visibility if the final publication audit write fails", async () => {
    const { id, packageId } = await contentFixture(), before = await revisionSnapshot(id), visibleBefore = await visibleContent(clientUser, packageId);
    // Offline-only failure injection after package publication, inside the same RPC transaction.
    await p.db.exec(`create function app_private.reject_synthetic_share() returns trigger language plpgsql as $$
      begin raise exception 'synthetic_share_failure'; end $$;
      create trigger reject_synthetic_share before insert on app_private.scoring_review_history
      for each row when (new.kind='share') execute function app_private.reject_synthetic_share();`);
    try {
      await expect(share(id)).rejects.toThrow(/synthetic_share_failure/);
      expect(await revisionSnapshot(id)).toEqual(before);
      expect(await visibleContent(clientUser, packageId)).toEqual(visibleBefore);
    } finally {
      await p.db.exec("drop trigger reject_synthetic_share on app_private.scoring_review_history; drop function app_private.reject_synthetic_share();");
    }
  });
});

describe("withdrawal cannot be reinstated through recruiter sharing", () => {
  it.each([
    { label: "empty", facts: [], screening: false },
    { label: "with reviewed content", facts: clientFacts, screening: true },
  ])("refuses a withdrawn package ($label) while its submission remains published", async (options) => {
    const { id, packageId } = await contentFixture(options);
    await p.db.query("update public.submission_packages set state='withdrawn' where id=$1", [packageId]);
    expect((await p.db.query("select s.publication from public.submissions s join app_private.scoring_assessments a on a.submission_id=s.id where a.id=$1", [id])).rows[0].publication).toBe("published");
    const before = await revisionSnapshot(id), visibleBefore = await visibleContent(clientUser, packageId);
    await expect(share(id)).rejects.toMatchObject({ code: "PT409", message: "client_package_withdrawn" });
    expect(await revisionSnapshot(id)).toEqual(before);
    expect(await visibleContent(clientUser, packageId)).toEqual(visibleBefore);
    expect(visibleBefore).toEqual({ packages: [], screening: [] });
  });
  it("refuses an unpublished submission without changing its package or reviewed content", async () => {
    const { id, packageId } = await contentFixture({ facts: clientFacts, screening: true });
    await p.db.query("update public.submissions set publication='unpublished' where id=(select submission_id from app_private.scoring_assessments where id=$1)", [id]);
    const before = await revisionSnapshot(id), visibleBefore = await visibleContent(clientUser, packageId);
    await expect(share(id)).rejects.toMatchObject({ code: "PT400", message: "submission_not_shared" });
    expect(await revisionSnapshot(id)).toEqual(before);
    expect(await visibleContent(clientUser, packageId)).toEqual(visibleBefore);
    expect(visibleBefore).toEqual({ packages: [], screening: [] });
  });
  it("rechecks withdrawal when sharing from a page loaded before the package was withdrawn", async () => {
    const { id } = await revisionFixture("share");
    const opened = (await asUser(p.db, staff, "select public.recruiter_assessment($1) as assessment", [id])).rows[0].assessment;
    const packageId = (await p.db.query("select published_package_id as id from app_private.scoring_assessments where id=$1", [id])).rows[0].id;
    expect((await p.db.query("select state from public.submission_packages where id=$1", [packageId])).rows[0].state).toBe("paused");
    await p.db.query("update public.submission_packages set state='withdrawn' where id=$1", [packageId]);
    const before = await revisionSnapshot(id), visibleBefore = await visibleContent(clientUser, packageId);
    // The assessment revision did not change: its cached page revision alone cannot detect withdrawal.
    expect(before.assessment[0].revision).toBe(opened.revision);
    await expect(share(id, opened.revision)).rejects.toMatchObject({ code: "PT409", message: "client_package_withdrawn" });
    expect(await revisionSnapshot(id)).toEqual(before);
    expect(await visibleContent(clientUser, packageId)).toEqual(visibleBefore);
  });
  it("still publishes an eligible summary despite withdrawn packages belonging to other submissions", async () => {
    const other = await contentFixture();
    await p.db.query("update public.submission_packages set state='withdrawn' where id=$1", [other.packageId]);
    const { id, packageId } = await contentFixture();
    const published = (await share(id)).rows[0].id;
    expect((await visibleContent(clientUser, published)).packages[0].state).toBe("published");
    expect((await p.db.query("select state from public.submission_packages where id=$1", [packageId])).rows[0].state).toBe("superseded");
  });
  it("does not treat superseded package history as withdrawal", async () => {
    const { id, packageId } = await contentFixture({ facts: clientFacts, screening: true });
    // The existing owner publication helper created a newer package; superseded history remains immutable.
    const newer = (await p.db.query(`insert into public.submission_packages(client_id,submission_id,role_id,requirement_set_id,version,why_shared)
      select client_id,submission_id,role_id,requirement_set_id,version+1,'New reviewed fictional summary.'
      from public.submission_packages where id=$1 returning id`, [packageId])).rows[0].id;
    await p.db.query(`insert into public.requirement_evidence(client_id,package_id,requirement_set_id,requirement_id,status,evidence,source_label)
      select client_id,$2,requirement_set_id,requirement_id,status,evidence,source_label from public.requirement_evidence where package_id=$1`, [packageId, newer]);
    await p.db.query("select app_private.publish_package($1)", [newer]);
    const history = (await p.db.query("select * from public.submission_packages where id=$1", [packageId])).rows;
    expect(history[0].state).toBe("superseded");
    const published = (await share(id)).rows[0].id;
    expect((await visibleContent(clientUser, published)).packages[0].state).toBe("published");
    expect((await p.db.query("select * from public.submission_packages where id=$1", [packageId])).rows).toEqual(history);
  });
});
