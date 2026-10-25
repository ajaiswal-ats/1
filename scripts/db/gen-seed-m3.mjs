/* Writes supabase/seed/m3_fictional.sql and m3_remove_fictional.sql: milestone 3 content (role descriptions, requirement
   sets, packages and evidence) for the two fictional clients of the milestone 1 seed. Harbor's content comes from the
   frontend's fictional dataset (src/data/fixtures.ts); Northwind's and the edge cases' text is fictional test text written
   here. Deterministic ids (md5 of a label). Sources are copied as they are; an empty source stays empty (null).
   Usage: node scripts/db/gen-seed-m3.mjs */
import fs from "node:fs";
import path from "node:path";
import { FIXTURE } from "../../src/data/fixtures.ts";
import { ROOT } from "./env.mjs";

const q = (s) => (s === null ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const arr = (xs) => (xs === null ? "null" : `array[${xs.map(q).join(", ")}]::text[]`);
const m1 = (...parts) => `md5(${q(["portal-m1", ...parts].join(":"))})::uuid`;
const m3 = (...parts) => `md5(${q(["portal-m3", ...parts].join(":"))})::uuid`;
const facts = (o) => `${q(JSON.stringify(Object.entries(o).map(([label, value]) => ({ label, value }))))}::jsonb`;
const STATUS = { sup: "supported", part: "partly_supported", none: "not_evidenced", notmet: "confirmed_not_met" };
const MONTHS = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
const labelDate = (label) => {
  const m = label.match(/(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/);
  if (!m) throw new Error(`no date in requirement label ${label}`);
  return `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}`;
};

/* ---- Content ---------------------------------------------------------------------------------------------------- */
const roles = FIXTURE.roles.map((r) => ({ client: "harbor", ref: r.id, summary: r.summary, resp: r.resp, jd: r.jd, hold: r.holdNote ?? null }));
roles.push({ client: "northwind", ref: "ops", summary: "Fictional test role: coordinate weekly operations reporting for a fictional company.",
  resp: ["Prepare the weekly operations report", "Track open purchase orders"], jd: "Fictional job description for access tests only. No real role.", hold: null });

const sets = [];
const reqs = [];
for (const r of FIXTURE.roles) {
  sets.push({ client: "harbor", role: r.id, v: 1, label: r.reqVer, agreedOn: labelDate(r.reqVer) });
  r.req.forEach(([text, tier], i) => reqs.push({ client: "harbor", role: r.id, v: 1, pos: i + 1, text, tier }));
}
/* Edge cases: a draft second version (never visible), and Northwind's superseded first version. */
sets.push({ client: "harbor", role: "isl", v: 2, label: "Version 2 · draft", agreedOn: null });
reqs.push({ client: "harbor", role: "isl", v: 2, pos: 1, text: "Fictional draft requirement (not agreed)", tier: "must" });
sets.push({ client: "northwind", role: "ops", v: 1, label: "Version 1 · 1 Oct 2026", agreedOn: "2026-10-01" });
sets.push({ client: "northwind", role: "ops", v: 2, label: "Version 2 · 12 Oct 2026", agreedOn: "2026-10-12" });
for (const v of [1, 2]) {
  reqs.push({ client: "northwind", role: "ops", v, pos: 1, text: `Fictional reporting requirement (version ${v})`, tier: "must" });
  reqs.push({ client: "northwind", role: "ops", v, pos: 2, text: `Fictional scheduling requirement (version ${v})`, tier: "pref" });
}

const roleOfSub = Object.fromEntries(FIXTURE.subs.map((s) => [s.id, s.role]));
const pkgs = FIXTURE.subs.map((s) => ({ client: "harbor", sub: s.id, role: s.role, set: 1, v: 1, why: s.why, strengths: s.strengths, clarify: s.clarify, facts: s.facts,
  evidence: s.req.map(([st, ev, src], i) => ({ pos: i + 1, status: STATUS[st], ev, src: src || null })) }));
const pkg = (sub, v) => pkgs.find((p) => p.sub === sub && p.v === v);
const fictionalEvidence = (n, note) => Array.from({ length: n }, (_, i) => ({ pos: i + 1, status: "supported", ev: `Fictional evidence ${i + 1} (${note}).`, src: "Resume" }));
/* Harbor edge cases. */
pkgs.push({ client: "harbor", sub: "je-isl", role: "isl", set: 1, v: 2, why: "Fictional draft revision (never published).", strengths: [], clarify: [], facts: {},
  evidence: fictionalEvidence(2, "draft, incomplete") });
pkgs.push({ client: "harbor", sub: "do-rsm", role: "rsm", set: 1, v: 2, why: "Fictional second version, paused after publication.", strengths: [], clarify: [], facts: {},
  evidence: fictionalEvidence(4, "paused") });
pkgs.push({ client: "harbor", sub: "zz-isl", role: "isl", set: 1, v: 1, why: "Fictional package of an unpublished submission.", strengths: [], clarify: [], facts: {},
  evidence: fictionalEvidence(5, "unpublished submission") });
/* Northwind: one package on the first (later superseded) version, one on an unpublished submission. */
pkgs.push({ client: "northwind", sub: "n1-ops", role: "ops", set: 1, v: 1, why: "Fictional Northwind package on requirements later superseded.", strengths: ["Fictional strength"], clarify: [], facts: { "Notice period": "Fictional" },
  evidence: [{ pos: 1, status: "supported", ev: "Fictional evidence.", src: "Resume" }, { pos: 2, status: "not_evidenced", ev: "Not mentioned.", src: null }] });
pkgs.push({ client: "northwind", sub: "n2-ops", role: "ops", set: 2, v: 1, why: "Fictional Northwind package of an unpublished submission.", strengths: [], clarify: [], facts: {},
  evidence: fictionalEvidence(2, "Northwind, unpublished submission") });

for (const p of pkgs) {
  const n = reqs.filter((r) => r.client === p.client && r.role === p.role && r.v === p.set).length;
  const draftIncomplete = p.sub === "je-isl" && p.v === 2;
  if (!draftIncomplete && p.evidence.length !== n) throw new Error(`${p.sub} v${p.v}: ${p.evidence.length} evidence rows for ${n} requirements`);
  if (p.client === "harbor" && roleOfSub[p.sub] && roleOfSub[p.sub] !== p.role) throw new Error(`${p.sub}: role mismatch`);
}

/* ---- SQL --------------------------------------------------------------------------------------------------------- */
const setId = (s) => m3("set", s.client, s.role, s.v);
const reqId = (r) => m3("req", r.client, r.role, r.v, r.pos);
const pkgId = (p) => m3("package", p.client, p.sub, p.v);
const fictional = `(${m1("client", "harbor")}, ${m1("client", "northwind")})`;
const publish = (sub, v, client = "harbor") => `select app_private.publish_package(${pkgId({ client, sub, v })});`;
const agree = (s) => `select app_private.agree_requirement_set(${setId(s)}, ${q(s.agreedOn)});`;
const isAgreedFirst = (s) => s.agreedOn !== null && !(s.client === "northwind" && s.v === 2);

const harborPublished = FIXTURE.subs.map((s) => s.id).filter((id) => id !== "do-rsm");
const seed = `begin;
do $$
begin
  if to_regclass('public.role_requirement_sets') is null then raise exception 'milestone 3 migration not found: nothing inserted'; end if;
  if (select count(*) from public.roles where client_id in ${fictional}) <> ${roles.length} or (select count(*) from public.submissions where client_id in ${fictional}) <> 15 then
    raise exception 'the milestone 1 fictional seed is not as expected: nothing inserted';
  end if;
  if exists (select 1 from public.role_requirement_sets) or exists (select 1 from public.submission_packages)
     or exists (select 1 from public.roles where summary is not null or responsibilities is not null or job_description is not null or hold_note is not null) then
    raise exception 'milestone 3 content already exists: nothing inserted (remove it first with m3_remove_fictional.sql)';
  end if;
end $$;

-- Role descriptions.
${roles.map((r) => `update public.roles set summary = ${q(r.summary)}, responsibilities = ${arr(r.resp)}, job_description = ${q(r.jd)}, hold_note = ${q(r.hold)} where id = ${m1("role", r.client, r.ref)};`).join("\n")}

-- Requirement sets (inserted as drafts) and their requirements.
insert into public.role_requirement_sets (id, client_id, role_id, version, label) values
  ${sets.map((s) => `(${setId(s)}, ${m1("client", s.client)}, ${m1("role", s.client, s.role)}, ${s.v}, ${q(s.label)})`).join(",\n  ")};
insert into public.role_requirements (id, client_id, set_id, position, text, tier) values
  ${reqs.map((r) => `(${reqId(r)}, ${m1("client", r.client)}, ${setId(r)}, ${r.pos}, ${q(r.text)}, ${q(r.tier)})`).join(",\n  ")};

-- Agree the first versions.
${sets.filter(isAgreedFirst).map(agree).join("\n")}

-- Packages (inserted as drafts) and their evidence.
insert into public.submission_packages (id, client_id, submission_id, role_id, requirement_set_id, version, why_shared, strengths, points_to_clarify, key_facts) values
  ${pkgs.map((p) => `(${pkgId(p)}, ${m1("client", p.client)}, ${m1("submission", p.client, p.sub)}, ${m1("role", p.client, p.role)}, ${setId({ client: p.client, role: p.role, v: p.set })}, ${p.v}, ${q(p.why)}, ${arr(p.strengths)}, ${arr(p.clarify)}, ${facts(p.facts)})`).join(",\n  ")};
insert into public.requirement_evidence (client_id, package_id, requirement_set_id, requirement_id, status, evidence, source_label) values
  ${pkgs.flatMap((p) => p.evidence.map((e) => `(${m1("client", p.client)}, ${pkgId(p)}, ${setId({ client: p.client, role: p.role, v: p.set })}, ${reqId({ client: p.client, role: p.role, v: p.set, pos: e.pos })}, ${q(e.status)}, ${q(e.ev)}, ${q(e.src)})`)).join(",\n  ")};

-- Publish: Harbor's fixture packages, the unpublished submission's package, Northwind's first package.
${harborPublished.map((s) => publish(s, 1)).join("\n")}
${publish("zz-isl", 1)}
${publish("n1-ops", 1, "northwind")}
-- do-rsm: version 1 published then withdrawn; version 2 published then paused (neither visible).
${publish("do-rsm", 1)}
update public.submission_packages set state = 'withdrawn' where id = ${pkgId({ client: "harbor", sub: "do-rsm", v: 1 })};
${publish("do-rsm", 2)}
update public.submission_packages set state = 'paused' where id = ${pkgId({ client: "harbor", sub: "do-rsm", v: 2 })};
-- Northwind: agree version 2 (supersedes version 1, hiding n1-ops' package), then publish n2-ops' package on it.
${agree(sets.find((s) => s.client === "northwind" && s.v === 2))}
${publish("n2-ops", 1, "northwind")}
commit;
`;

const counts = {
  roles: roles.length, sets: sets.length, requirements: reqs.length, packages: pkgs.length, evidence: pkgs.reduce((n, p) => n + p.evidence.length, 0),
  harborVisible: { sets: FIXTURE.roles.length, requirements: reqs.filter((r) => r.client === "harbor" && r.v === 1).length, packages: harborPublished.length,
    evidence: harborPublished.reduce((n, s) => n + pkg(s, 1).evidence.length, 0) },
  northwindVisible: { sets: 1, requirements: 2, packages: 0, evidence: 0 },
};
const summary = `${counts.roles} role descriptions, ${counts.sets} requirement sets, ${counts.requirements} requirements, ${counts.packages} packages, ${counts.evidence} evidence rows`;
const header = (what) => `-- GENERATED by scripts/db/gen-seed-m3.mjs from src/data/fixtures.ts and fictional test text. Do not edit by hand. Fictional data only.\n-- ${what}\n`;

const remove = `begin;
do $$
begin
  if to_regclass('public.role_requirement_sets') is null then raise exception 'milestone 3 not found: nothing changed'; end if;
end $$;
-- The explicit fictional cleanup (see the migration header): table owner, fictional clients only, this transaction only.
select set_config('app.m3_fictional_cleanup', 'on', true);
delete from public.requirement_evidence where client_id in ${fictional};
delete from public.submission_packages where client_id in ${fictional};
delete from public.role_requirements where client_id in ${fictional};
delete from public.role_requirement_sets where client_id in ${fictional};
update public.roles set summary = null, responsibilities = null, job_description = null, hold_note = null where client_id in ${fictional};
select set_config('app.m3_fictional_cleanup', '', true);
commit;
`;

fs.writeFileSync(path.join(ROOT, "supabase/seed/m3_fictional.sql"), header(`Milestone 3 seed: ${summary}. One transaction.
-- It stops without changing anything unless milestone 3 is applied, the milestone 1 fictional seed is present, and no
-- milestone 3 content exists yet. Expected visible rows: Harbor ${JSON.stringify(counts.harborVisible)}; Northwind ${JSON.stringify(counts.northwindVisible)}.`) + seed);
fs.writeFileSync(path.join(ROOT, "supabase/seed/m3_remove_fictional.sql"), header(`Removes ALL milestone 3 content of the two fictional clients (evidence, packages, requirements, sets) and clears
-- their role descriptions. One transaction. Milestones 1 and 2 are not touched. Run it before m1_reset_fictional.sql or
-- m1_remove_fictional.sql, and before rolling milestone 3 back: frozen content blocks those deletes otherwise.`) + remove);
fs.writeFileSync(path.join(ROOT, "supabase/seed/m3_counts.json"), JSON.stringify(counts, null, 2) + "\n");
console.log(`wrote supabase/seed/m3_fictional.sql, m3_remove_fictional.sql, m3_counts.json: ${summary}`);
