import { useState, type FormEvent, type ReactNode } from "react";
import logo from "../assets/revenue-optics-logo.png";
import { BriefIcon, ChartIcon, PeopleIcon } from "../components/icons";
import { useTheme, type Theme } from "../lib/theme";
import { navFor, type NavKey } from "../lib/route";
import type { AuthState, ClientInfo, Member, SessionUser } from "./session";
import { WorkspacePage, NO_MOVES, type MovesProps } from "../workspace/DbViews";
import { keyOf, type WorkspaceState } from "../workspace/store";
import { utcToday } from "../workspace/data";

/* The Supabase portal's screens, drawn only from the session state: sign-in, the states around it, and the signed-in shell.
   The shell keeps the reviewed layout (sidebar, top bar, page) but shows no workspace data yet: that is the next milestone.
   No demo component or fictional data is used here. There is no public registration. */

export interface AuthActions { signIn(email: string, password: string): void; signOut(): void; retry(): void }
/** Workspace data for the signed-in account, and how to retry loading it. */
export interface WorkspaceProps { state: WorkspaceState; retry(): void; today?: string; moves?: Omit<MovesProps, "account"> & { account?: string }; devRecording?: boolean }
const NO_WORKSPACE: WorkspaceProps = { state: { status: "idle" }, retry: () => {} };

const DEV_NOTE = "Development · fictional test accounts only · access is by invitation";

function Card({ title, children, label }: { title: string; children: ReactNode; label?: string }) {
  return (
    <div className="auth">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand"><img alt="Revenue Optics" src={logo} /></div>
        <div className="auth-body">
          {label && <p className="auth-kicker">{label}</p>}
          <h1 id="auth-title">{title}</h1>
          {children}
        </div>
        <p className="mock auth-dev">{DEV_NOTE}</p>
      </section>
    </div>
  );
}

export function SignIn({ pending, error, notice, onSignIn }: { pending: boolean; error: string | null; notice: string | null; onSignIn: AuthActions["signIn"] }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const submit = (e: FormEvent) => { e.preventDefault(); onSignIn(email, password); };
  return (
    <Card title="Sign in" label="Client workspace">
      <p className="auth-lede">Use the email address your Revenue Optics recruiter invited.</p>
      {notice && <p className="auth-msg info" role="status">{notice}</p>}
      {error && <p className="auth-msg crit" role="alert" id="auth-error">{error}</p>}
      <form onSubmit={submit} noValidate>
        <div className="auth-field">
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" name="email" type="email" autoComplete="username" required value={email} disabled={pending}
            aria-describedby={error ? "auth-error" : undefined} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="auth-field">
          <label htmlFor="auth-password">Password</label>
          <input id="auth-password" name="password" type="password" autoComplete="current-password" required value={password} disabled={pending}
            aria-describedby={error ? "auth-error" : undefined} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-p auth-submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="auth-foot">Access is by invitation only. If you cannot sign in, contact your Revenue Optics recruiter.</p>
    </Card>
  );
}

const SignedInAs = ({ user }: { user: SessionUser }) => <p className="auth-who">Signed in as <b>{user.email || "this account"}</b></p>;

export function AuthView({ state, route, actions, workspace = NO_WORKSPACE }: { state: AuthState; route: string; actions: AuthActions; workspace?: WorkspaceProps }) {
  switch (state.status) {
    case "restoring":
      return <Card title="Restoring your session…"><p className="auth-lede" role="status">Checking this browser for a saved sign-in.</p></Card>;
    case "signed-out":
      return <SignIn pending={state.pending} error={state.error} notice={state.notice} onSignIn={actions.signIn} />;
    case "loading":
      return (
        <Card title="Loading your workspace…">
          <SignedInAs user={state.user} />
          <p className="auth-lede" role="status">Checking which client workspace this account can open.</p>
        </Card>
      );
    case "no-access":
      return (
        <Card title="No workspace access">
          <SignedInAs user={state.user} />
          <p className="auth-msg warn" role="status">This account is not linked to an active client workspace. It may not have been added yet, or its access may have been switched off.</p>
          <p className="auth-lede">Contact your Revenue Optics recruiter if you expected to see your company's candidates.</p>
          <div className="auth-actions"><button type="button" className="btn btn-s" onClick={actions.signOut}>Sign out</button></div>
        </Card>
      );
    case "error":
      return (
        <Card title="Workspace not loaded">
          <SignedInAs user={state.user} />
          <p className="auth-msg crit" role="alert">{state.message}</p>
          <div className="auth-actions">
            <button type="button" className="btn btn-p" onClick={actions.retry}>Try again</button>
            <button type="button" className="btn btn-s" onClick={actions.signOut}>Sign out</button>
          </div>
        </Card>
      );
    case "ready":
      return <Workspace route={route} user={state.user} member={state.member} client={state.client} onSignOut={actions.signOut} workspace={workspace} />;
  }
}

export function ConfigProblem({ problem }: { problem: string }) {
  return (
    <Card title="Portal not configured">
      <p className="auth-msg crit" role="alert">{problem}</p>
      <p className="auth-lede">Fix <code>.env.local</code> and restart the development server. The fictional demo is not shown in its place.</p>
    </Card>
  );
}

/** Up to two initials from the display name, ignoring anything in brackets such as "(test)". */
export const initials = (name: string) =>
  name.replace(/\([^)]*\)/g, " ").split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

function Workspace({ route, user, member, client, onSignOut, workspace }: { route: string; user: SessionUser; member: Member; client: ClientInfo; onSignOut(): void; workspace: WorkspaceProps }) {
  const current = navFor(route), [theme, setTheme] = useTheme();
  /* Data is used only if it belongs to this exact user and client; anything else counts as still loading. */
  const key = keyOf({ userId: user.id, clientId: client.id }), raw = workspace.state;
  const ws: WorkspaceState = raw.status !== "idle" && raw.key === key ? raw : { status: "loading", key };
  const note = ws.status === "ready" ? `${ws.ws.roles.length} ${ws.ws.roles.length === 1 ? "role" : "roles"} with Revenue Optics` : "Client workspace";
  const here = (k: NavKey) => (current === k ? { "aria-current": "page" as const } : {});
  const themeButton = (t: Theme, label: string) => <button type="button" aria-pressed={theme === t} onClick={() => setTheme(t)}>{label}</button>;
  return (
    <div className="shell">
      <aside className="side" aria-label="Main navigation">
        <div className="sbrand"><span className="lg"><img alt="Revenue Optics" src={logo} /></span></div>
        <div className="client"><b>{client.name}</b><span>{note}</span></div>
        <nav className="nav" id="nav">
          <a href="#candidates" {...here("candidates")}><PeopleIcon />Candidates</a>
          <a href="#roles" {...here("roles")}><BriefIcon />Roles</a>
          <div className="grp">Reports</div>
          <a href="#progress" {...here("progress")}><ChartIcon />Hiring progress</a>
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="top-in">
            <div className="tright">
              <div className="seg theme" role="group" aria-label="Theme">{themeButton("light", "Light")}{themeButton("dark", "Dark")}</div>
              <div className="me">
                <span className="who"><b>{member.displayName}</b>{member.jobTitle && <span>{member.jobTitle}</span>}</span>
                <span className="av me-av" aria-hidden="true">{initials(member.displayName)}</span>
              </div>
              <button type="button" className="resetbtn" onClick={onSignOut}>Sign out</button>
            </div>
          </div>
          <div className="mockline proto">Development · fictional test data from the database · stage changes are saved to the database only: nobody is notified and Manatal is not updated{workspace.devRecording ? " · test-run recording on" : ""}</div>
        </header>
        <main className="page" id="page" tabIndex={-1}>
          <WorkspacePage key={key} route={route} state={ws} onRetry={workspace.retry} today={workspace.today ?? utcToday()}
            moves={workspace.moves ? { ...workspace.moves, account: key } : NO_MOVES} />
        </main>
      </div>
    </div>
  );
}
