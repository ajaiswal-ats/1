/* Fictional data copied from client-workspace-v1-visual-2h (ROLES, SEED, SEED_MOVES, RO_SEARCH, INTERVIEWS_HELD).
   This is the one base dataset every page reads (through DataProvider, which replays the demo changes saved in this browser
   onto a copy of it). */

export type RoleStatus = "Open" | "On hold" | "Closed";
export type Stage = "To review" | "Interview" | "Offer" | "Hired" | "Declined";
export type Actor = "you" | "ro";
export type ReqTier = "must" | "pref";
/** Evidence status for one role requirement: supported, partly supported, not evidenced, confirmed not met. */
export type ReqStatus = "sup" | "part" | "none" | "notmet";

export interface Role {
  id: string;
  title: string;
  loc: string;
  status: RoleStatus;
  opened: string;
  /** Assigned Revenue Optics recruiter. */
  contact: string;
  /** Version of the approved requirements. */
  reqVer: string;
  /** Shown on the role page while the role is on hold. */
  holdNote?: string;
  summary: string;
  /** What the role involves. */
  resp: string[];
  /** Job description. */
  jd: string;
  /** Approved requirements: [text, tier]. */
  req: [string, ReqTier][];
}

export type ClientInterviewStatus = "none" | "requested" | "scheduled" | "held" | "feedback";
/** What happens next, and who it is waiting on. */
export type NextKind = "review" | "feedback" | "scheduled" | "scheduling" | "offer" | "followup" | "moved" | "moved-outcome" | "hired" | "closed";

/** One record per candidate and role. */
export interface Submission {
  id: string;
  /** Person id: one person can be shared for more than one role. */
  pid: string;
  name: string;
  role: string;
  /** Latest saved stage. */
  stage: Stage;
  /** Date Revenue Optics shared the candidate with the client. */
  shared: string;
  head: string;
  loc: string;
  /** Why Revenue Optics shared the candidate for this role. */
  why: string;
  /** Evidence per role requirement, in the role's order: [status, evidence, source]. */
  req: [ReqStatus, string, string][];
  strengths: string[];
  clarify: string[];
  facts: Record<string, string>;
  /** Revenue Optics screening call, if one has been shared. Moments are [minute, label]. */
  iv: ScreeningCall | null;
  /** Client interview. */
  client: { status: ClientInterviewStatus; date?: string; time?: string; with?: string; slots?: string };
  /** Offer outcome recorded by Revenue Optics (separate from the saved stage). */
  outcome: { status: "Offer made" | "Offer accepted"; d: string } | null;
  next: { who: Actor | "none"; kind: NextKind; since?: string };
  /** The client's decline note, once declined. */
  declineNote?: { text: string; cat: string; date: string };
}

export interface ScreeningCall {
  date: string;
  /** Minutes. */
  dur: number;
  by: string;
  summary: string;
  notes: string;
  moments: [number, string][];
}

/** A note the client added with a decision or after an interview. */
export interface ClientNote {
  kind: "Interview feedback" | "Note with stage move";
  about?: string;
  text: string;
  d: string;
}

/** A saved stage change after sharing. */
export interface StageMove {
  sid: string;
  to: Stage;
  d: string;
  by: Actor;
}

/** A Revenue Optics search record: sourced date, screened date, linked submission once shared, and closed date if not progressed. */
export interface SearchRecord {
  role: string;
  so: string;
  sc: string | null;
  sid: string | null;
  cl: string | null;
}

/** A client interview recorded as held (not a Revenue Optics screening call). */
export interface InterviewHeld {
  sid: string;
  d: string;
}

export interface Dataset {
  roles: Role[];
  subs: Submission[];
  moves: StageMove[];
  search: SearchRecord[];
  held: InterviewHeld[];
  /** Client notes per submission. */
  notes: Record<string, ClientNote[]>;
  /** History per submission: [date, what happened]. Submissions without an entry start from "shared". */
  hist: Record<string, [string, string][]>;
}

/** Demo "today", as in 2h. */
export const TODAY = "2026-10-12";

export const CLIENT = { name: "Harbor Industrial Supply", note: "Fictional client" };
export const CURRENT_USER = { name: "Maria Alvarez", title: "Hiring manager", initials: "MA" };

const ROLES: Role[] = [
  { id: "isl", title: "Inside Sales Leader", loc: "Chicago, IL · Hybrid", status: "Open", opened: "2026-09-15", contact: "Jamie Scott", reqVer: "Version 1 · 15 Sep 2026",
    summary: "Lead and coach a team of six inside sales representatives who support branch and field sales across the Midwest.",
    resp: ["Coach six inside sales reps through weekly one-to-ones and call reviews","Own the inside sales pipeline and weekly forecast","Work with branch managers on quotes, follow-up and account handoffs","Hire and onboard new representatives as the team grows"],
    jd: "Harbor Industrial Supply is looking for an Inside Sales Leader to build a consistent, coached inside sales team. You will set call and quote standards, review pipeline weekly, and work closely with branch managers so customers get fast, accurate answers.",
    req: [["Experience leading inside or branch sales teams", "must"], ["Industrial distribution background", "must"], ["Comfort with CRM pipeline reporting", "must"], ["Coaching and call-review routine", "must"], ["Spanish language skills", "pref"]] },
  { id: "pa", title: "Pricing Analyst", loc: "Remote · US", status: "Open", opened: "2026-09-22", contact: "Jamie Scott", reqVer: "Version 1 · 22 Sep 2026",
    summary: "Analyse pricing performance and margin trends, and recommend price changes for key product lines.",
    resp: ["Track margin by product line, branch and customer segment","Model the effect of proposed price changes","Write clear recommendations for the commercial team"],
    jd: "A hands-on analyst role reporting to the VP Commercial. You will turn pricing and margin data into specific, defensible recommendations.",
    req: [["Advanced spreadsheet and pricing analysis", "must"], ["Experience in distribution or manufacturing", "must"], ["Clear written recommendations", "must"], ["SQL or BI tool experience", "pref"]] },
  { id: "fsr", title: "Field Sales Representative", loc: "Dallas, TX · Field-based", status: "Open", opened: "2026-10-05", contact: "Jamie Scott", reqVer: "Version 1 · 5 Oct 2026",
    summary: "Manage and grow a territory of industrial customers through regular site visits.",
    resp: ["Visit 25–30 accounts a month","Grow share of wallet with existing customers","Work with inside sales on quotes and follow-up"],
    jd: "A field role covering the Dallas–Fort Worth area, with a company vehicle.",
    req: [["Territory sales experience", "must"], ["Valid driving licence", "must"], ["Technical product knowledge", "must"], ["Existing Dallas customer relationships", "pref"]] },
  { id: "rsm", title: "Regional Sales Manager", loc: "Milwaukee, WI · Hybrid", status: "On hold", opened: "2026-09-01", contact: "Jamie Scott", reqVer: "Version 1 · 1 Sep 2026",
    holdNote: "On hold since 8 Oct 2026. Candidates already shared stay visible, and feedback after a completed interview is still welcome.",
    summary: "Lead a regional team of field and inside sales staff across Wisconsin and northern Illinois.",
    resp: ["Lead four branch sales teams","Set regional targets and review performance monthly","Coach field managers on account planning"],
    jd: "A senior sales leadership role for the Wisconsin and northern Illinois region.",
    req: [["Experience managing a multi-branch sales region", "must"], ["Industrial distribution background", "must"], ["Field sales management", "must"], ["Experience with CRM-based sales forecasting", "pref"]] },
];

const SUBMISSIONS: Submission[] = [
  { id: "tb-isl", pid: "tb", name: "Taylor Brooks", role: "isl", stage: "To review", shared: "2026-10-09",
    head: "Inside Sales Manager · Lakeshore Fastener Co.", loc: "Evanston, IL",
    why: "Taylor has led an eight-person inside sales team at a fastener distributor for four years and runs a weekly call-review routine. Revenue Optics shared Taylor because the team-leadership and distribution experience match the role closely; CRM reporting depth is the main point to confirm.",
    req: [
      ["sup", "Led an eight-person inside sales team since 2022.", "Resume"],
      ["sup", "Nine years in fastener and MRO distribution.", "Resume"],
      ["part", "Mentions weekly pipeline reviews; reporting tool not named.", "Interview 14:05"],
      ["sup", "Describes weekly call reviews and a coaching scorecard.", "Interview 21:40"],
      ["none", "Not mentioned in the approved evidence.", ""],
    ],
    strengths: ["Has run the same kind of team this role leads","Clear, structured coaching routine","Knows branch handoffs from the distributor side"], clarify: ["Which CRM reports Taylor builds personally","Comfort with the hybrid schedule (three office days)"],
    facts: { "Notice period": "4 weeks", "Work arrangement": "Hybrid works; based 25 minutes from Chicago office", "Team size led": "8 representatives" },
    iv: { date: "2026-10-07", dur: 32, by: "Jamie Scott",
      summary: "Taylor walked through how the current team is organised, the weekly call-review routine, and a recent project to cut quote turnaround from two days to same-day. Taylor is looking for a larger team and a more structured sales process.",
      notes: "Strong, specific answers on coaching. Was less specific on CRM reporting. Wants clarity on the office schedule.",
      moments: [[3,"Current team and responsibilities"],[14,"Pipeline reviews and reporting"],[21,"Coaching routine and call reviews"],[27,"Why Taylor is looking now"]] },
    client: { status: "none" }, outcome: null, next: { who: "you", kind: "review", since: "2026-10-09" } },
  { id: "tb-rsm", pid: "tb", name: "Taylor Brooks", role: "rsm", stage: "Interview", shared: "2026-09-22",
    head: "Inside Sales Manager · Lakeshore Fastener Co.", loc: "Evanston, IL",
    why: "Shared for the regional role because of Taylor's distribution background and team leadership. Taylor has not managed a multi-branch region, which is the main gap.",
    req: [
      ["part", "Leads one inside team that supports three branches; has not managed branches directly.", "Resume"],
      ["sup", "Nine years in fastener and MRO distribution.", "Resume"],
      ["notmet", "Confirmed in the screening call: no field sales management.", "Interview 18:30"],
      ["none", "Not mentioned in the approved evidence.", ""],
    ],
    strengths: ["Distribution experience","Structured coaching"], clarify: ["Readiness for a regional, multi-branch scope"],
    facts: { "Notice period": "4 weeks", "Work arrangement": "Hybrid; open to regular travel to Milwaukee" },
    iv: { date: "2026-09-19", dur: 28, by: "Jamie Scott",
      summary: "Covered Taylor's current team, branch support and interest in a regional role.",
      notes: "Interested in the regional scope but has not led field managers.",
      moments: [[4,"Branch support today"],[18,"Field sales experience"]] },
    client: { status: "held", date: "2026-10-06", with: "Maria Alvarez" }, outcome: null, next: { who: "you", kind: "feedback", since: "2026-10-06" } },
  { id: "je-isl", pid: "je", name: "Jordan Ellis", role: "isl", stage: "Interview", shared: "2026-09-24",
    head: "Branch Sales Supervisor · Prairie Electric Supply", loc: "Naperville, IL",
    why: "Jordan supervises counter and inside sales at a large electrical distributor branch and has introduced CRM dashboards for the team.",
    req: [
      ["sup", "Supervises five inside and counter sales staff.", "Resume"],
      ["sup", "Seven years in electrical distribution.", "Resume"],
      ["sup", "Built the branch's CRM pipeline dashboard.", "Interview 11:20"],
      ["part", "Coaches informally; no set routine described.", "Interview 19:05"],
      ["sup", "Fluent in Spanish.", "Resume"],
    ],
    strengths: ["Hands-on CRM reporting","Bilingual"], clarify: ["How Jordan would set up a coaching routine"],
    facts: { "Notice period": "2 weeks", "Work arrangement": "Hybrid works" },
    iv: { date: "2026-09-22", dur: 30, by: "Jamie Scott",
      summary: "Jordan described running branch sales, building CRM dashboards, and wanting to lead a dedicated inside team.",
      notes: "Good reporting skills; coaching less structured.",
      moments: [[5,"Branch role today"],[11,"CRM dashboard"],[19,"Coaching approach"]] },
    client: { status: "scheduled", date: "2026-10-15", time: "10:00–10:45 CT", with: "Maria Alvarez, Daniel Kim" }, outcome: null, next: { who: "none", kind: "scheduled" } },
  { id: "pr-isl", pid: "pr", name: "Priya Raman", role: "isl", stage: "To review", shared: "2026-10-07",
    head: "Inside Sales Team Lead · Great Lakes Packaging", loc: "Chicago, IL",
    why: "Priya leads a four-person inside sales team in packaging distribution and has strong CRM reporting experience. Team size is smaller than this role.",
    req: [
      ["part", "Leads a four-person team; this role leads six.", "Resume"],
      ["sup", "Six years in packaging distribution.", "Resume"],
      ["sup", "Owns weekly CRM pipeline reports for the region.", "Interview 09:40"],
      ["none", "Not mentioned in the approved evidence.", ""],
      ["none", "Not mentioned in the approved evidence.", ""],
    ],
    strengths: ["Strong reporting habits","Local to the Chicago office"], clarify: ["Coaching approach","Readiness for a larger team"],
    facts: { "Notice period": "3 weeks", "Work arrangement": "Hybrid works" },
    iv: { date: "2026-10-05", dur: 26, by: "Jamie Scott",
      summary: "Priya described her team, reporting routine and interest in leading a larger group.",
      notes: "Reporting is a clear strength; ask about coaching.",
      moments: [[3,"Team today"],[9,"Weekly reports"]] },
    client: { status: "none" }, outcome: null, next: { who: "you", kind: "review", since: "2026-10-07" } },
  { id: "mw-isl", pid: "mw", name: "Marcus Webb", role: "isl", stage: "Declined", shared: "2026-09-25",
    head: "Account Manager · Midwest Bearings", loc: "Joliet, IL",
    why: "Strong account management background; no team leadership yet.",
    req: [
      ["notmet", "No team leadership experience.", "Interview 07:10"],
      ["sup", "Eight years in bearings distribution.", "Resume"],
      ["part", "Uses CRM daily; limited reporting.", "Interview 12:00"],
      ["none", "Not mentioned.", ""],
      ["none", "Not mentioned.", ""],
    ],
    strengths: ["Customer relationships"], clarify: [],
    facts: { "Notice period": "2 weeks" },
    iv: null,
    client: { status: "none" }, outcome: null, next: { who: "none", kind: "closed" },
    declineNote: { text: "Good account manager, but this role needs someone who has already led a team.", cat: "Experience not aligned", date: "2026-10-02" } },
  { id: "en-pa", pid: "en", name: "Elena Novak", role: "pa", stage: "To review", shared: "2026-10-08",
    head: "Senior Pricing Analyst · Keystone Industrial Parts", loc: "Pittsburgh, PA",
    why: "Elena runs margin analysis for a 40,000-item catalogue and writes the monthly pricing memo for her commercial team.",
    req: [
      ["sup", "Builds pricing models in Excel and Power BI.", "Resume"],
      ["sup", "Five years at an industrial parts distributor.", "Resume"],
      ["sup", "Writes a monthly pricing memo; sample excerpt approved.", "Excerpt E1"],
      ["sup", "Uses SQL weekly.", "Interview 16:30"],
    ],
    strengths: ["Directly relevant catalogue size","Clear writer"], clarify: ["Time-zone overlap with the Chicago team"],
    facts: { "Notice period": "4 weeks", "Work arrangement": "Remote" },
    iv: { date: "2026-10-06", dur: 29, by: "Jamie Scott",
      summary: "Elena explained her pricing models and how she presents recommendations.",
      notes: "Very strong fit on the requirements.",
      moments: [[6,"Pricing model walk-through"],[16,"SQL and BI tools"]] },
    client: { status: "none" }, outcome: null, next: { who: "you", kind: "review", since: "2026-10-08" } },
  { id: "so-pa", pid: "so", name: "Samuel Ortiz", role: "pa", stage: "Interview", shared: "2026-09-29",
    head: "Pricing Analyst · Copperline Manufacturing", loc: "Denver, CO",
    why: "Samuel models price changes for a manufacturer selling through distributors.",
    req: [
      ["sup", "Builds price-change models monthly.", "Resume"],
      ["sup", "Four years in manufacturing.", "Resume"],
      ["part", "Presents findings verbally; written examples not shared.", "Interview 20:15"],
      ["none", "Not mentioned.", ""],
    ],
    strengths: ["Modelling depth"], clarify: ["Written communication"],
    facts: { "Notice period": "2 weeks", "Work arrangement": "Remote" },
    iv: { date: "2026-09-26", dur: 25, by: "Jamie Scott",
      summary: "Samuel described his pricing models and manufacturing context.",
      notes: "Ask for a written sample.",
      moments: [[8,"Modelling approach"]] },
    client: { status: "requested", date: "2026-10-06", slots: "Tue 13 Oct morning or Wed 14 Oct afternoon" }, outcome: null, next: { who: "ro", kind: "scheduling", since: "2026-10-06" } },
  { id: "bc-pa", pid: "bc", name: "Ben Carter", role: "pa", stage: "Declined", shared: "2026-09-23",
    head: "Business Analyst · Summit Retail Group", loc: "Columbus, OH",
    why: "Strong analyst from retail; no distribution pricing.",
    req: [
      ["part", "Advanced spreadsheets; no pricing models.", "Resume"],
      ["notmet", "Retail only.", "Resume"],
      ["sup", "Clear written reports.", "Excerpt E1"],
      ["sup", "SQL daily.", "Resume"],
    ],
    strengths: [], clarify: [],
    facts: {  },
    iv: null,
    client: { status: "none" }, outcome: null, next: { who: "none", kind: "closed" },
    declineNote: { text: "We need someone who has priced in distribution or manufacturing.", cat: "Experience not aligned", date: "2026-09-25" } },
  { id: "gl-rsm", pid: "gl", name: "Grace Liu", role: "rsm", stage: "Offer", shared: "2026-09-10",
    head: "Area Sales Manager · Northfield Supply", loc: "Madison, WI",
    why: "Grace manages three branches' field teams for a regional distributor.",
    req: [
      ["sup", "Manages three branch field teams.", "Resume"],
      ["sup", "Twelve years in industrial distribution.", "Resume"],
      ["sup", "Leads six field reps through two managers.", "Interview 10:10"],
      ["sup", "Runs the region's CRM forecast.", "Interview 22:00"],
    ],
    strengths: ["Has done this job at a smaller scale"], clarify: [],
    facts: { "Notice period": "6 weeks" },
    iv: { date: "2026-09-08", dur: 34, by: "Jamie Scott",
      summary: "Grace covered her region, team structure and forecasting.",
      notes: "Excellent fit.",
      moments: [[10,"Team structure"],[22,"Forecasting"]] },
    client: { status: "feedback", date: "2026-09-17", with: "Maria Alvarez" }, outcome: { status: "Offer made", d: "2026-10-05" }, next: { who: "ro", kind: "offer", since: "2026-10-05" } },
  { id: "do-rsm", pid: "do", name: "Daniel Okafor", role: "rsm", stage: "Hired", shared: "2026-09-03",
    head: "Regional Sales Lead · Badger Industrial", loc: "Green Bay, WI",
    why: "Placed earlier in the search.",
    req: [
      ["sup", "Manages a two-branch region.", "Resume"],
      ["sup", "Ten years in distribution.", "Resume"],
      ["sup", "Field management experience.", "Resume"],
      ["part", "Uses CRM forecasts; does not build them.", "Interview 15:00"],
    ],
    strengths: [], clarify: [],
    facts: { "Start date": "2 Nov 2026" },
    iv: null,
    client: { status: "feedback", date: "2026-09-09", with: "Maria Alvarez" }, outcome: { status: "Offer accepted", d: "2026-09-28" }, next: { who: "none", kind: "hired" } },
  { id: "ab-fsr", pid: "ab", name: "Aisha Bello", role: "fsr", stage: "To review", shared: "2026-10-10",
    head: "Territory Sales Representative · Lone Star Fluid Power", loc: "Arlington, TX",
    why: "Aisha covers a Dallas-area territory for a hydraulics distributor and visits about 30 accounts a month.",
    req: [
      ["sup", "Five years covering a Dallas territory.", "Resume"],
      ["sup", "Confirmed in the screening call.", "Interview 02:30"],
      ["sup", "Hydraulics and fluid power products.", "Resume"],
      ["part", "Knows several local plants; customer list not shared.", "Interview 12:45"],
    ],
    strengths: ["Same territory","Technical product knowledge"], clarify: ["Non-compete terms, if any"],
    facts: { "Notice period": "2 weeks", "Work arrangement": "Field-based in Dallas" },
    iv: { date: "2026-10-09", dur: 24, by: "Jamie Scott",
      summary: "Aisha described her territory, visit routine and product range.",
      notes: "Ready to move quickly.",
      moments: [[2,"Licence and travel"],[12,"Local customers"]] },
    client: { status: "none" }, outcome: null, next: { who: "you", kind: "review", since: "2026-10-10" } },
  { id: "cm-rsm", pid: "cm", name: "Chris Morales", role: "rsm", stage: "Interview", shared: "2026-09-16",
    head: "Branch Manager · Riverbend Industrial", loc: "Rockford, IL",
    why: "Chris manages a large branch and its field team.",
    req: [
      ["part", "Single large branch.", "Resume"],
      ["sup", "Fifteen years in distribution.", "Resume"],
      ["sup", "Manages four field reps.", "Interview 08:00"],
      ["none", "Not mentioned.", ""],
    ],
    strengths: ["Deep branch experience"], clarify: ["Multi-branch scope"],
    facts: { "Notice period": "4 weeks" },
    iv: { date: "2026-09-14", dur: 31, by: "Jamie Scott",
      summary: "Chris described his branch and field team.",
      notes: "Solid; scope is the question.",
      moments: [[8,"Field team"]] },
    client: { status: "feedback", date: "2026-09-29", with: "Maria Alvarez" }, outcome: null, next: { who: "ro", kind: "followup", since: "2026-10-01" } },
];

const MOVES: StageMove[] = [
  { sid: "do-rsm", to: "Interview", d: "2026-09-08", by: "you" },
  { sid: "cm-rsm", to: "Interview", d: "2026-09-18", by: "you" },
  { sid: "gl-rsm", to: "Interview", d: "2026-09-15", by: "you" },
  { sid: "do-rsm", to: "Offer", d: "2026-09-19", by: "ro" },
  { sid: "bc-pa", to: "Declined", d: "2026-09-25", by: "you" },
  { sid: "do-rsm", to: "Hired", d: "2026-09-28", by: "ro" },
  { sid: "je-isl", to: "Interview", d: "2026-09-29", by: "you" },
  { sid: "tb-rsm", to: "Interview", d: "2026-09-30", by: "you" },
  { sid: "mw-isl", to: "Declined", d: "2026-10-02", by: "you" },
  { sid: "gl-rsm", to: "Offer", d: "2026-10-05", by: "ro" },
  { sid: "so-pa", to: "Interview", d: "2026-10-06", by: "you" },
];

/* [role, sourced, screened, submission, closed] */
const SEARCH_ROWS: [string, string, string | null, string | null, string | null][] = [
  ["isl", "2026-10-01", "2026-10-07", "tb-isl", null], ["isl", "2026-09-16", "2026-09-22", "je-isl", null], ["isl", "2026-09-28", "2026-10-05", "pr-isl", null],
  ["isl", "2026-09-17", "2026-09-23", "mw-isl", null], ["isl", "2026-09-16", "2026-09-21", null, "2026-09-23"], ["isl", "2026-09-18", "2026-09-24", null, "2026-09-26"],
  ["isl", "2026-09-29", "2026-10-06", null, null], ["isl", "2026-10-02", "2026-10-08", null, null], ["isl", "2026-09-16", null, null, "2026-09-19"],
  ["isl", "2026-09-17", null, null, "2026-09-21"], ["isl", "2026-09-19", null, null, "2026-09-22"], ["isl", "2026-09-22", null, null, "2026-09-25"],
  ["isl", "2026-09-24", null, null, "2026-09-29"], ["isl", "2026-09-30", null, null, "2026-10-03"], ["isl", "2026-10-05", null, null, null],
  ["isl", "2026-10-07", null, null, null], ["isl", "2026-10-08", null, null, null], ["isl", "2026-10-09", null, null, null],
  ["pa", "2026-10-01", "2026-10-06", "en-pa", null], ["pa", "2026-09-23", "2026-09-26", "so-pa", null], ["pa", "2026-09-22", "2026-09-22", "bc-pa", null],
  ["pa", "2026-09-23", "2026-09-28", null, "2026-09-30"], ["pa", "2026-09-25", "2026-09-30", null, "2026-10-02"], ["pa", "2026-10-03", "2026-10-08", null, null],
  ["pa", "2026-09-22", null, null, "2026-09-24"], ["pa", "2026-09-24", null, null, "2026-09-28"], ["pa", "2026-09-26", null, null, "2026-09-29"],
  ["pa", "2026-09-30", null, null, "2026-10-05"], ["pa", "2026-10-05", null, null, null], ["pa", "2026-10-06", null, null, null],
  ["pa", "2026-10-08", null, null, null], ["pa", "2026-10-09", null, null, null], ["fsr", "2026-10-05", "2026-10-09", "ab-fsr", null],
  ["fsr", "2026-10-06", "2026-10-09", null, null], ["fsr", "2026-10-06", "2026-10-10", null, "2026-10-11"], ["fsr", "2026-10-05", null, null, "2026-10-07"],
  ["fsr", "2026-10-06", null, null, "2026-10-08"], ["fsr", "2026-10-07", null, null, null], ["fsr", "2026-10-08", null, null, null],
  ["fsr", "2026-10-09", null, null, null], ["fsr", "2026-10-10", null, null, null], ["rsm", "2026-09-01", "2026-09-02", "do-rsm", null],
  ["rsm", "2026-09-02", "2026-09-08", "gl-rsm", null], ["rsm", "2026-09-04", "2026-09-14", "cm-rsm", null], ["rsm", "2026-09-15", "2026-09-19", "tb-rsm", null],
  ["rsm", "2026-09-03", "2026-09-07", null, "2026-09-09"], ["rsm", "2026-09-05", "2026-09-11", null, "2026-09-12"], ["rsm", "2026-09-10", "2026-09-17", null, "2026-09-18"],
  ["rsm", "2026-09-01", null, null, "2026-09-04"], ["rsm", "2026-09-02", null, null, "2026-09-05"], ["rsm", "2026-09-04", null, null, "2026-09-08"],
  ["rsm", "2026-09-08", null, null, "2026-09-11"], ["rsm", "2026-09-11", null, null, "2026-09-15"], ["rsm", "2026-09-14", null, null, "2026-09-18"],
  ["rsm", "2026-09-18", null, null, "2026-09-22"], ["rsm", "2026-09-22", null, null, "2026-09-26"], ["rsm", "2026-10-01", null, null, "2026-10-06"],
];

const INTERVIEWS_HELD: InterviewHeld[] = [
  { sid: "do-rsm", d: "2026-09-09" },
  { sid: "gl-rsm", d: "2026-09-16" },
  { sid: "cm-rsm", d: "2026-09-24" },
  { sid: "tb-rsm", d: "2026-10-06" },
];

const HISTORY: Record<string, [string, string][]> = {
  "tb-rsm": [["2026-09-22","Revenue Optics shared Taylor for this role"],["2026-09-30","You moved Taylor to Interview"],["2026-10-06","Interview held with Maria Alvarez"]],
  "gl-rsm": [["2026-09-10","Revenue Optics shared Grace"],["2026-09-15","You moved Grace to Interview"],["2026-09-17","You shared interview feedback"],["2026-10-05","Revenue Optics recorded that an offer was made"]],
};

export const FIXTURE: Dataset = {
  roles: ROLES,
  subs: SUBMISSIONS,
  moves: MOVES,
  search: SEARCH_ROWS.map(([role, so, sc, sid, cl]) => ({ role, so, sc, sid, cl })),
  held: INTERVIEWS_HELD,
  notes: {},
  hist: HISTORY,
};
