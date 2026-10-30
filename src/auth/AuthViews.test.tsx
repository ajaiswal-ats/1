/* The Supabase portal's screens for each session state: no registration, no demo data, clear account states. */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLIENT, CURRENT_USER, FIXTURE } from "../data/fixtures";
import { AuthView, ConfigProblem, initials } from "./AuthViews";
import { MESSAGES, type AuthState } from "./session";

beforeEach(() => { (globalThis as { document?: unknown }).document = { documentElement: { getAttribute: () => "light" } }; });
afterEach(() => { delete (globalThis as { document?: unknown }).document; });

const noop = { signIn: () => {}, signOut: () => {}, retry: () => {} };
const user = { id: "u1", email: "jo@example.com" };
const view = (state: AuthState, route = "candidates") => renderToStaticMarkup(<AuthView state={state} route={route} actions={noop} />);
const ready: AuthState = { status: "ready", user, member: { id: "m1", clientId: "c1", displayName: "Jo Doe (test)", jobTitle: "Hiring manager" }, client: { id: "c1", name: "Test Client Co" } };
/** Strings from the demo's fictional dataset that must never appear in the Supabase portal. */
const demoStrings = [CLIENT.note, CURRENT_USER.name, ...FIXTURE.subs.map((s) => s.name), ...FIXTURE.roles.map((r) => r.title)];

describe("sign-in screen", () => {
  it("uses Sample 1's brand-and-form layout without demo credentials or a made-up client", () => {
    const h = view({ status: "signed-out", pending: false, error: null, notice: null });
    expect(h).toContain('aria-label="About this workspace"');
    expect(h).toContain("Your hiring workspace with Revenue Optics");
    expect(h).toContain("Review shared candidates, record decisions and follow hiring progress in one place.");
    expect(h).toMatch(/id="auth-title"[^>]*>Sign in to your workspace<\/h1>/);
    expect(h).toContain('aria-label="Show password"');
    expect(h).toContain('aria-controls="auth-password"');
    expect(h).not.toContain(CLIENT.name);
    expect(h).not.toMatch(/Fill demo|Simulate a connection/);
  });
  it("offers help, an honest recovery explanation and an isolated demo, without registration", () => {
    const h = view({ status: "signed-out", pending: false, error: null, notice: null });
    expect(h).toContain('type="email"');
    expect(h).toContain('autoComplete="username"');
    expect(h).toContain('autoComplete="current-password"');
    expect(h).toContain(">Sign in</button>");
    expect(h).not.toMatch(/sign up|create (an )?account|register/i);
    expect(h).toContain('aria-controls="auth-recovery-info"');
    expect(h).toContain('aria-expanded="false"');
    expect(h).toContain('>Forgot password?</button>');
    expect(h).toContain('href="#help?topic=signin"');
    expect(h).toContain('href="/demo.html#candidates" target="_blank" rel="noopener noreferrer"');
    expect(h).toContain('>Explore demo</a>');
    expect(h).toContain("by invitation only");
  });
  it("shows errors and notices, and disables the form while signing in", () => {
    expect(view({ status: "signed-out", pending: false, error: MESSAGES.wrong, notice: null })).toContain(`role="alert" id="auth-error">${MESSAGES.wrong}`);
    expect(view({ status: "signed-out", pending: false, error: null, notice: MESSAGES.signedOutOffline })).toContain('role="status"');
    const busy = view({ status: "signed-out", pending: true, error: null, notice: null });
    expect(busy).toContain("Signing in…");
    expect(busy.match(/disabled=""/g)).toHaveLength(5);
  });
  it("allows signed-out access to sign-in guidance without any workspace or demo data", () => {
    const h = view({ status: "signed-out", pending: false, error: null, notice: null }, "help");
    expect(h).toContain('id="auth-title"');
    expect(h).toContain('Sign-in help');
    expect(h).toContain('Passwords and access tokens');
    expect(h).toContain('>Back to sign in</a>');
    expect(h).not.toContain('class="shell"');
    expect(h).not.toContain('id="auth-password"');
    expect(h).not.toContain(CLIENT.name);
  });
});

describe("account states", () => {
  it("restoring and loading say what is happening", () => {
    expect(view({ status: "restoring" })).toContain("Restoring your session…");
    const h = view({ status: "loading", user });
    expect(h).toContain("Loading your workspace…");
    expect(h).toContain("jo@example.com");
  });
  it("no access (inactive or unassigned) explains it and offers sign-out only", () => {
    const h = view({ status: "no-access", user });
    expect(h).toContain("No workspace access");
    expect(h).toContain("not linked to an active client workspace");
    expect(h).toContain(">Sign out</button>");
    expect(h).not.toContain('class="shell"');
  });
  it("a load error offers retry and sign-out, and shows no workspace", () => {
    const h = view({ status: "error", user, message: MESSAGES.account });
    expect(h).toContain(">Try again</button>");
    expect(h).toContain(">Sign out</button>");
    expect(h).not.toContain('class="shell"');
  });
  it("a misconfigured portal says so instead of showing the demo", () => {
    const h = renderToStaticMarkup(<ConfigProblem problem="VITE_SUPABASE_ANON_KEY is empty." />);
    expect(h).toContain("Portal not configured");
    expect(h).toContain("VITE_SUPABASE_ANON_KEY is empty.");
  });
  it("no screen shows the demo's fictional data", () => {
    const states: AuthState[] = [{ status: "restoring" }, { status: "signed-out", pending: false, error: null, notice: null }, { status: "loading", user }, { status: "no-access", user }, { status: "error", user, message: MESSAGES.account }, ready];
    for (const s of states) for (const route of ["candidates", "roles", "progress", "c-tb-isl", "role-isl"]) {
      const h = view(s, route);
      for (const d of demoStrings) expect(h, `${s.status} ${route}: ${d}`).not.toContain(d);
    }
  });
});

describe("signed-in workspace shell", () => {
  it("keeps the reviewed layout with the real client and member, and a sign-out button", () => {
    const h = view(ready, "roles");
    for (const c of ['class="shell"', 'class="side"', 'class="topbar"', 'class="page"']) expect(h).toContain(c);
    expect(h).toContain("<b>Test Client Co</b>");
    expect(h).toContain("<b>Jo Doe (test)</b><span>Hiring manager</span>");
    expect(h).toContain('aria-hidden="true">JD</span>');
    expect(h).toContain('href="#roles" aria-current="page"');
    expect(h).toContain("<h1>Roles</h1>");
    expect(h).toContain("Loading workspace data…");   // no data for this account yet
    expect(h).toContain(">Sign out</button>");
  });
  it("leaves out what the database does not provide, rather than filling it in", () => {
    const h = view({ ...ready, member: { ...ready.member, jobTitle: "" } } as AuthState);
    expect(h).toContain("<b>Jo Doe (test)</b></span>");
    expect(h).not.toContain('class="ct"');            // no waiting count without data
    expect(h).not.toContain('role="search"');         // no search without data
  });
  it("initials ignore bracketed notes", () => {
    expect(initials("Maria Alvarez (test)")).toBe("MA");
    expect(initials("Northwind member (test)")).toBe("NM");
    expect(initials("Cher")).toBe("C");
  });
});
