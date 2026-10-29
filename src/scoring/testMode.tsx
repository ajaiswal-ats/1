import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AuthView } from "../auth/AuthViews";
import type { AuthState } from "../auth/session";
import { useHashRoute } from "../lib/route";
import { loadWorkspace } from "../workspace/data";
import { WorkspaceExtensionProvider, type WorkspaceExtension } from "../workspace/extensions";
import { fakeDb } from "../workspace/fakeDb";
import { createWorkspaceController } from "../workspace/store";
import { loadData } from "./api";
import { AssessFlow } from "./AssessFlow";
import { AssessHome, AssessmentHistory, EarlierAssessments, groupCandidates } from "./AssessHome";
import { AssessmentStatus, AssessmentSummary, BlockedAssessmentPanel, ClientAssessmentSummary, ClientNextStep, EXPERIMENTAL, RoleScoringPanel, ScreeningNotAssessed, TestHistory } from "./AssessmentPanels";
import { configFor, isBlocked, viewOf, type AssessmentPayload, type AssessmentView, type BlockedAssessment, type PrivateData } from "./model";
import "./scoring.css";

/* The local scoring test mode of the portal (development builds only; see src/main.tsx and vite.scoring.config.mjs).
   It renders the deployed portal's own signed-in shell and pages (AuthView → WorkspacePage) for an explicit local test
   account, with an explicit test-data adapter: the private assessment data from the local scoring server becomes ordinary
   portal rows (one role, four submissions shown as Candidate A–D), read through the real workspace loader and its checks
   via the in-memory Data API stand-in. No Supabase client is created, nothing is signed in, and no candidate action can be
   sent: the Next step panel's actions are replaced. The assessment appears through the workspace extension points. */

export const TEST_CLIENT = { id: "local-scoring-test", name: "Local scoring test" };
const TEST_STATE: AuthState = {
  status: "ready",
  user: { id: "local-scoring-test-user", email: "" },
  member: { id: "local-scoring-test-member", clientId: TEST_CLIENT.id, displayName: "Local reviewer (test)", jobTitle: "Scoring test · not a client account" },
  client: TEST_CLIENT,
};
const MODE_LINE = "Local test mode · client view · actions are off · this page sends nothing elsewhere";
const INTERNAL_LINE = `Local test mode · recruiter review · ${EXPERIMENTAL} · separate local address, not a sign-in · this page sends nothing elsewhere`;
/** The local address of the recruiter's assessment and review tools. The client view never links to it. Choosing the
    view by address only separates the presentations on this computer; it is not authentication. */
export const REVIEW_PATH = "/review";
export const viewForPath = (pathname: string): "client" | "internal" => (pathname.replace(/\/+$/, "") === REVIEW_PATH ? "internal" : "client");
/** Where the portal says "Shared", test candidates say when they were added to this local test. */
export const ADDED = { long: "Added to local test", short: "Added" };
const NO_AUTH = { signIn: () => {}, signOut: () => {}, retry: () => {} };

type Row = Record<string, unknown>;
/** The test data as the portal's own tables (only the columns the loader reads). Tables not given are "not applied".
    Blocked assessments still appear as submissions (so the candidate shows its blocked state), with no assessment data. */
export function testTables(data: PrivateData): Record<string, Row[]> {
  if (!data.available) throw new Error(data.problems.join(" ") || "The private scoring data is not available.");
  const c = TEST_CLIENT.id, all = (data.assessments ?? []).filter((a) => a.role);
  /* One person per candidate: assessments of the same recorded CV file are one candidate, shown with the latest
     assessment; earlier ones stay in that candidate's history (groupCandidates). */
  const groups = groupCandidates(all), subs = groups.map((g) => g.latest), group = new Map(groups.map((g) => [g.latest.id, g]));
  /* One role row per role id, from a validated run input where there is one. */
  const roles = new Map<string, NonNullable<AssessmentPayload["role"]>>();
  for (const a of subs) if (!roles.has(a.role!.id) || (!isBlocked(a) && !roles.get(a.role!.id)!.resp.length)) roles.set(a.role!.id, a.role!);
  const day = (a: AssessmentPayload) => (a.addedAt ?? (isBlocked(a) ? "" : a.createdAt)).slice(0, 10);
  return {
    roles: [...roles.values()].map((role) => ({ id: role.id, client_id: c, title: role.title, location: role.loc, status: "Open", opened_on: subs.map(day).filter(Boolean).sort()[0], recruiter_name: "",
      summary: role.summary ? `${role.summary} Test role for the local scoring test: the role setup and assessment rules are drafts, not agreed.` : null, responsibilities: role.resp, job_description: null, hold_note: null })),
    people: subs.map((a) => ({ id: `person-${a.id}`, client_id: c, name: group.get(a.id)!.name, headline: isBlocked(a) ? "Test candidate · assessment unavailable" : a.intakeId ? "Added CV · AI-proposed draft assessment" : "Test candidate · draft CV assessment", location: "" })),
    /* The loader needs a date per submission: the recorded time the candidate was added to this test (shown as "Added to
       local test", never as a sharing date). No history entry is created: nothing was shared with a client. */
    submissions: subs.map((a) => ({ id: a.id, client_id: c, role_id: a.role!.id, person_id: `person-${a.id}`, stage: "To review", shared_on: (group.get(a.id)!.firstAdded ?? day(a)).slice(0, 10), publication: "published", version: 1 })),
    submission_events: [],
    /* Milestone 3 tables exist but hold no agreed requirements and no published summary: the draft rubric is not an agreed
       requirement set, and nothing here is a client-approved package. */
    role_requirement_sets: [], submission_packages: [], role_requirements: [], requirement_evidence: [],
  };
}

export function ScoringTestRoot() {
  const route = useHashRoute(), [data, setData] = useState<PrivateData | null>(null), [view] = useState(() => viewForPath(location.pathname));
  const reload = useCallback(() => loadData().then(setData, () => setData({ available: false, problems: ["The local scoring server did not respond."] })), []);
  /* The server is the only source of truth: refetch on every page change and when the tab is shown again, so a change made
     elsewhere (another tab, a new run, a correction) is never hidden behind data loaded earlier. */
  useEffect(() => { void reload(); }, [reload, route]);
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === "visible") void reload(); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [reload]);

  const controller = useMemo(() => createWorkspaceController(async (clientId) => {
    if (!data) throw new Error("not loaded");
    return loadWorkspace(fakeDb(testTables(data)).db, clientId);
  }), [data]);
  useEffect(() => { if (data) controller.sync({ userId: TEST_STATE.status === "ready" ? TEST_STATE.user.id : "", clientId: TEST_CLIENT.id }); }, [controller, data]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);

  /* Each assessment is calculated under exactly the rubric it names; one without it is treated as blocked here too. */
  const { views, blocked } = useMemo(() => {
    const m = new Map<string, AssessmentView>(), x = new Map<string, BlockedAssessment>();
    if (data?.available) for (const a of [...(data.assessments ?? []), ...(data.fictional ? [data.fictional] : [])]) {
      if (isBlocked(a)) { x.set(a.id, a); continue; }
      const cfg = configFor(data.configs, a);
      if (!cfg) { x.set(a.id, { id: a.id, label: a.label, status: "blocked", problems: ["the rubric it names is not available"], submissionId: a.id, addedAt: a.addedAt ?? null, role: null }); continue; }
      m.set(a.id, viewOf(a, cfg, a.corrections ?? [], data.frozen?.results ?? []));
    }
    return { views: m, blocked: x };
  }, [data]);
  const earlierFor = (id: string) => { const g = groups.find((x) => x.latest.id === id); return g && g.items.length > 1 ? { count: g.items.length - 1, node: <EarlierAssessments group={g} views={views} shownId={id} /> } : undefined; };
  const groups = useMemo(() => (data?.available ? groupCandidates((data.assessments ?? []).filter((x) => x.role)) : []), [data]);
  const real = [...views.values()].find((v) => v.record.kind === "real"), config = real?.config ?? null;
  const rules = real?.record.consistencyRules ?? [];
  /* Client preview (default): a concise draft review, no score or technical detail. Internal review: everything a
     Revenue Optics reviewer needs, including scores, calculation, rubric and corrections. Not access control: this mode
     exists only on this computer's development server. */
  const internal = view === "internal";
  const ext: WorkspaceExtension = {
    candidatesNote: internal ? "Internal review: listed in the portal's usual order, not by score. Each draft assessment is in the candidate's Summary tab. Actions are off."
      : "Local test: each candidate's draft CV review is in their Summary tab. Stage changes, decline and feedback are off.",
    summary: (sub) => { const b = blocked.get(sub.id); if (b) return <BlockedAssessmentPanel b={b} internal={internal} />;
      const v = views.get(sub.id); return !v ? null : internal ? <AssessmentSummary v={v} rules={rules} onChanged={reload} earlier={earlierFor(sub.id)} screeningSets={data?.available ? data.screeningSets : undefined} /> : <ClientAssessmentSummary v={v} />; },
    screening: (sub) => (blocked.has(sub.id) || views.get(sub.id)?.record.kind === "real" ? <ScreeningNotAssessed /> : null),
    history: (sub) => { const g = groups.find((x) => x.latest.id === sub.id);
      return g ? <AssessmentHistory group={g} views={views} shownId={sub.id} /> : views.has(sub.id) || blocked.has(sub.id) ? <TestHistory addedAt={(views.get(sub.id)?.record ?? blocked.get(sub.id))!.addedAt} /> : null; },
    /* The scoring tool's home screen (Internal review): the assessment list, not the hiring pipeline. The client preview
       keeps the portal's own list, with no scores. */
    candidatesPage: () => (internal ? <AssessHome groups={groups} views={views} /> : null),
    added: ADDED,
    actions: (sub) => { const v = views.get(sub.id); return v && internal ? <AssessmentStatus v={v} /> : <ClientNextStep />; },
    /* Actions are off in this local test, so neither view reserves a column for a Next step panel; the stage stays in the header. */
    hideNextStep: () => true,
    role: (role) => (internal && config && role.id === config.role.id ? <RoleScoringPanel config={config} rules={rules} example={views.get("fict-x") ?? null} /> : null),
    /* The recruiter's own workflow page, separate from the client's candidate pages. */
    tools: internal && data?.available ? [{ route: "assess", label: "Assess a CV", render: () => <AssessFlow configs={data.configs ?? []} onAssessed={reload} /> }] : [],
  };
  /* No switch between views: the client view has no control or link to the recruiter tools (served at /review). */
  const label = internal ? <span className="chip c-warn">Recruiter review · local test</span> : undefined;
  return (
    <WorkspaceExtensionProvider value={ext}>
      <AuthView state={TEST_STATE} route={route} actions={NO_AUTH}
        workspace={{ state, retry: controller.retry, modeLine: `${internal ? INTERNAL_LINE : MODE_LINE}${data && !data.available ? ` · ${data.problems.join(" ")}` : ""}`, noSignOut: true, topControls: label }} />
    </WorkspaceExtensionProvider>
  );
}
