import { CandidatesContextScope, useCandidatesHref } from "../lib/candidatesRoute";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { HELP_TOPICS } from "../help/HelpPage";
import logo from "../assets/revenue-optics-logo.png";
import colourLogo from "../assets/revenue-optics-logo-colour.png";
import { BriefIcon, ChartIcon, HelpIcon, PeopleIcon, EyeIcon } from "../components/icons";
import { ShellActions } from "../components/ShellActions";
import { isCandidatesList, navFor, type NavKey } from "../lib/route";
import { NavScrim, TopBarStart, useNavDrawer } from "../components/NavDrawer";
import { useWorkspaceExtension } from "../workspace/extensions";
import type { AuthState, ClientInfo, Member, SessionUser } from "./session";
import { WorkspacePage, NO_MOVES, type MovesProps } from "../workspace/DbViews";
import { keyOf, type WorkspaceState } from "../workspace/store";
import { utcToday } from "../workspace/data";
import { waitingCount } from "../workspace/next";

/* The Supabase portal's screens, drawn only from the session state: sign-in, the states around it, and the signed-in shell.
   The shell keeps the reviewed layout (sidebar, top bar, page) but shows no workspace data yet: that is the next milestone.
   No demo component or fictional data is used here. There is no public registration. */

export interface AuthActions { signIn(email: string, password: string): void; signOut(): void; retry(): void }
/** Workspace data for the signed-in account, and how to retry loading it. */
export interface WorkspaceProps {
  state: WorkspaceState; retry(): void; today?: string; moves?: Omit<MovesProps, "account"> & { account?: string }; devRecording?: boolean;
  /** Replaces the development line under the top bar (the local scoring test uses it to say what it is). */
  modeLine?: string;
  /** No session to end (the local scoring test has no sign-in). */
  noSignOut?: boolean;
  /** Extra controls at the start of the top bar's right side (the local scoring test's view switch). */
  topControls?: ReactNode;
}
const NO_WORKSPACE: WorkspaceProps = { state: { status: "idle" }, retry: () => {} };

const DEV_NOTE = "Development · fictional test accounts only · access is by invitation";

function Card({ title, children, label, login = false }: { title: string; children: ReactNode; label?: string; login?: boolean }) {
  if (login) return (
    <main className="auth auth-login">
      <aside className="auth-login-art" aria-label="About this workspace">
        <img src={logo} alt="Revenue Optics" width="180" />
        <div><p className="auth-login-tag">Your hiring workspace with Revenue Optics</p><p>Review shared candidates, record decisions and follow hiring progress in one place.</p></div>
      </aside>
      <section className="auth-login-form" aria-labelledby="auth-title">
        <div className="auth-login-inner">
          <div className="auth-login-logos"><img className="auth-logo-light" src={colourLogo} alt="Revenue Optics" width="140" /><img className="auth-logo-dark" src={logo} alt="Revenue Optics" width="140" /></div>
          <h1 id="auth-title" tabIndex={-1}>{title}</h1>
          {children}
        </div>
      </section>
    </main>
  );
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
  const [showPassword, setShowPassword] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const submit = (e: FormEvent) => { e.preventDefault(); onSignIn(email, password); };
  return (
    <Card title="Sign in to your workspace" login>
      <p className="auth-lede">Use the email address your Revenue Optics recruiter invited.</p>
      <p className="auth-login-note">{DEV_NOTE}</p>
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
          <div className="auth-password-wrap">
            <input id="auth-password" name="password" type={showPassword && !pending ? "text" : "password"} autoComplete="current-password" required value={password} disabled={pending}
              aria-describedby={error ? "auth-error" : undefined} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="auth-password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} aria-controls="auth-password" aria-pressed={showPassword} disabled={pending} onClick={() => setShowPassword(!showPassword)}><EyeIcon hidden={showPassword} /></button>
          </div>
        </div>
        <div className="auth-recovery"><button type="button" className="auth-link" disabled={pending} aria-expanded={recoveryOpen} aria-controls="auth-recovery-info" onClick={() => setRecoveryOpen(!recoveryOpen)}>Forgot password?</button></div>
        <p id="auth-recovery-info" className="auth-login-note" role="status" hidden={!recoveryOpen}>Password recovery is not connected yet. No recovery email has been sent. Follow the access instructions in your invitation or contact your Revenue Optics recruiter through your existing channel.</p>
        <button type="submit" className="btn btn-p auth-submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      </form>
      <div className="auth-or">or</div>
      <a className="auth-demo" href="/demo.html#candidates" target="_blank" rel="noopener noreferrer" aria-describedby="auth-demo-note">Explore demo</a>
      <span className="sr" id="auth-demo-note">Opens a separate fictional demo. Your workspace session is unchanged.</span>
      <p className="auth-help"><a href="#help?topic=signin">Sign-in help</a></p>
      <p className="auth-foot">Access is by invitation only. If you cannot sign in, contact your Revenue Optics recruiter.</p>
    </Card>
  );
}

const SignedInAs = ({ user }: { user: SessionUser }) => <p className="auth-who">Signed in as <b>{user.email || "this account"}</b></p>;

function SignInHelp() {
  useEffect(() => { document.getElementById("auth-title")?.focus(); }, []);
  const topic = HELP_TOPICS.find(t => t.id === "signin")!;
  return <Card title="Sign-in help" login><div className="auth-public-help">{topic.body.map(p => <p key={p}>{p}</p>)}<p>Passwords and access tokens should never be shared.</p></div><a className="auth-demo" href="#candidates">Back to sign in</a></Card>;
}

export function AuthView({ state, route, actions, workspace = NO_WORKSPACE }: { state: AuthState; route: string; actions: AuthActions; workspace?: WorkspaceProps }) {
  switch (state.status) {
    case "restoring":
      return <Card title="Restoring your session…"><p className="auth-lede" role="status">Checking this browser for a saved sign-in.</p></Card>;
    case "signed-out":
      return route === "help" ? <SignInHelp /> : <SignIn pending={state.pending} error={state.error} notice={state.notice} onSignIn={actions.signIn} />;
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
  const current = navFor(route), drawer = useNavDrawer();
  /* Data is used only if it belongs to this exact user and client; anything else counts as still loading. */
  const key = keyOf({ userId: user.id, clientId: client.id }), raw = workspace.state;
  const candidatesHref=useCandidatesHref(key);
  const ws: WorkspaceState = raw.status !== "idle" && raw.key === key ? raw : { status: "loading", key };
  const note = ws.status === "ready" ? `${ws.ws.roles.length} ${ws.ws.roles.length === 1 ? "role" : "roles"} with Revenue Optics` : "Client workspace";
  const today = workspace.today ?? utcToday(), waiting = ws.status === "ready" && ws.ws.steps ? waitingCount(ws.ws, ws.ws.subs, today) : 0;
  const tools = useWorkspaceExtension()?.tools ?? [], isTool = tools.some((t) => t.route === route);
  const here = (k: NavKey) => (current === k && !isTool ? { "aria-current": "page" as const } : {});
  return (
    <CandidatesContextScope.Provider value={key}><div className={drawer.open ? "shell nav-open" : "shell"}>
      <aside className="side" id="side" aria-label="Main navigation">
        <div className="sbrand"><span className="lg"><img alt="Revenue Optics" src={logo} /></span></div>
        <div className="client"><b>{client.name}</b><span>{note}</span></div>
        <nav className="nav" id="nav">
          <a href={candidatesHref} {...here("candidates")}><PeopleIcon />Candidates{waiting > 0 && <span className="ct" aria-label={`${waiting} waiting on you`}>{waiting}</span>}</a>
          <a href="#roles" {...here("roles")}><BriefIcon />Roles</a>
          <div className="grp">Reports</div>
          <a href="#progress" {...here("progress")}><ChartIcon />Hiring progress</a>
          <div className="grp">Support</div><a href="#help" {...here("help")}><HelpIcon/>Help and support</a>
          {tools.length > 0 && <><div className="grp">Recruiter tools</div>{tools.map((t) => <a key={t.route} href={`#${t.route}`} {...(route === t.route ? { "aria-current": "page" as const } : {})}><BriefIcon />{t.label}</a>)}</>}
        </nav>
        <ShellActions current={current} onSignOut={workspace.noSignOut ? undefined : onSignOut} />
      </aside>
      <NavScrim drawer={drawer} />
      <div className="main">
        <header className="topbar">
          <div className="top-in">
            <TopBarStart drawer={drawer} />
            <div className="tright">
              {workspace.topControls}
              <div className="me">
                <span className="who"><b>{member.displayName}</b>{member.jobTitle && <span>{member.jobTitle}</span>}</span>
                <span className="av me-av" aria-hidden="true">{initials(member.displayName)}</span>
              </div>
            </div>
          </div>
          <div className="mockline proto">{workspace.modeLine ?? `Development · fictional test data from the database · stage changes are saved to the database only: nobody is notified and Manatal is not updated${workspace.devRecording ? " · test-run recording on" : ""}`}</div>
        </header>
        <main className={isCandidatesList(route) && !isTool ? "page pg-cands" : route.startsWith("c-") ? "page pg-detail" : "page"} id="page" tabIndex={-1}>
          <WorkspacePage key={key} route={route} state={ws} onRetry={workspace.retry} today={today}
            moves={workspace.moves ? { ...workspace.moves, account: key } : NO_MOVES} memberId={member.id} />
        </main>
      </div>
    </div></CandidatesContextScope.Provider>
  );
}
