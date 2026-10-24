/* Sign-in and session state for the Supabase portal, without React, so every transition can be tested.
   Rules:
   * The account (membership and client) belongs to one user id. Whenever the session's user changes, or the session ends,
     the account is dropped at once, before anything for the new user loads. Late answers for an earlier user are ignored.
   * A failed sign-in or account load is shown as such. Nothing falls back to the demo's fictional data.
   * Inactive and unassigned accounts look the same to the browser (row-level security hides both), so they share one state.
   * Sign-out clears the account immediately, even if the sign-in service cannot be reached.
   * A sign-in attempt's own result (session, error or exception) is used only while that attempt is still the current
     one. If anything newer happened meanwhile (another tab signed in, the user signed out), it is ignored and the state
     keeps following the SDK's session events, which reflect the session actually stored. */

export interface SessionUser { id: string; email: string }
export interface Member { id: string; clientId: string; displayName: string; jobTitle: string }
export interface ClientInfo { id: string; name: string }
export type Account = { kind: "active"; member: Member; client: ClientInfo } | { kind: "none" };

export type AuthState =
  | { status: "restoring" }
  | { status: "signed-out"; pending: boolean; error: string | null; notice: string | null }
  | { status: "loading"; user: SessionUser }
  | { status: "ready"; user: SessionUser; member: Member; client: ClientInfo }
  | { status: "no-access"; user: SessionUser }
  | { status: "error"; user: SessionUser; message: string };

interface Session { user: { id: string; email?: string | null } }
interface AuthError { message?: string; code?: string; status?: number; name?: string }
/** The parts of supabase.auth used here (so tests can pass a fake). */
export interface AuthClient {
  getSession(): Promise<{ data: { session: Session | null }; error: AuthError | null }>;
  onAuthStateChange(cb: (event: string, session: Session | null) => void): { data: { subscription: { unsubscribe(): void } } };
  signInWithPassword(c: { email: string; password: string }): Promise<{ data: { session: Session | null }; error: AuthError | null }>;
  signOut(o: { scope: "local" }): Promise<{ error: AuthError | null }>;
}
export type LoadAccount = (userId: string) => Promise<Account>;

export const MESSAGES = {
  missing: "Enter your email and password.",
  wrong: "The email or password is incorrect.",
  limited: "Too many sign-in attempts. Wait a few minutes, then try again.",
  unconfirmed: "This account has not been confirmed yet. Contact your Revenue Optics recruiter.",
  offline: "The sign-in service could not be reached. Check your connection and try again.",
  other: "Sign-in did not work. Try again, or contact your Revenue Optics recruiter.",
  restore: "Your previous session could not be restored. Sign in again.",
  account: "Your workspace could not be loaded. Nothing is shown in its place.",
  signedOutOffline: "Signed out on this device. The sign-in service could not be reached, so the session may stay valid there until it expires.",
  storage: "This browser could not save your sign-in because its storage for this site is full. Free up or allow site data for this site, then try again.",
  unexpected: "Sign-in did not complete because of an unexpected problem in this browser. Reload the page, then try again.",
};

/** Recognised browser-storage failures when the sign-in is saved (supabase-js rethrows these instead of returning an error). */
export const isStorageFailure = (e: unknown) => {
  const name = (e as { name?: unknown } | null)?.name, code = (e as { code?: unknown } | null)?.code;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
};

export function signInMessage(e: AuthError): string {
  if (e.code === "invalid_credentials") return MESSAGES.wrong;
  if (e.status === 429 || e.code === "over_request_rate_limit") return MESSAGES.limited;
  if (e.code === "email_not_confirmed") return MESSAGES.unconfirmed;
  if (e.name === "AuthRetryableFetchError" || !e.status) return MESSAGES.offline;
  if (e.status === 400) return MESSAGES.wrong;
  return MESSAGES.other;
}

export interface AuthController {
  getState(): AuthState;
  subscribe(listener: () => void): () => void;
  start(): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  retry(): void;
}

const signedOut = (error: string | null = null, notice: string | null = null): AuthState => ({ status: "signed-out", pending: false, error, notice });
const userOf = (s: Session | null): SessionUser | null => (s?.user?.id ? { id: s.user.id, email: s.user.email ?? "" } : null);

export function createAuthController(auth: AuthClient, loadAccount: LoadAccount, defer: (f: () => void) => void = (f) => setTimeout(f, 0)): AuthController {
  let state: AuthState = { status: "restoring" };
  let generation = 0;            // bumped on every change of user or sign-out; older account loads are discarded
  let attempt = 0;               // the current sign-in attempt; results of older attempts are ignored
  let userId: string | null = null;
  const listeners = new Set<() => void>();
  const set = (s: AuthState) => { state = s; listeners.forEach((l) => l()); };
  const now = () => state;   // read after an await: the state may have changed meanwhile

  const load = async (user: SessionUser) => {
    const mine = ++generation;
    set({ status: "loading", user });
    try {
      const a = await loadAccount(user.id);
      if (mine !== generation) return;
      set(a.kind === "active" ? { status: "ready", user, member: a.member, client: a.client } : { status: "no-access", user });
    } catch {
      if (mine === generation) set({ status: "error", user, message: MESSAGES.account });
    }
  };

  const end = (error: string | null = null, notice: string | null = null) => { generation++; userId = null; set(signedOut(error, notice)); };

  /** A session arrived (restored, signed in, refreshed, or from another tab). Same user: keep what is shown. */
  const apply = (session: Session | null) => {
    const user = userOf(session);
    if (!user) { if (state.status !== "signed-out") end(); return; }
    if (user.id === userId && state.status !== "restoring" && state.status !== "signed-out") return;
    userId = user.id;
    void load(user);
  };

  return {
    getState: () => state,
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    start() {
      /* supabase-js asks that the callback make no other Supabase calls directly, so the work is deferred. */
      const { data } = auth.onAuthStateChange((event, session) => defer(() => (event === "SIGNED_OUT" ? state.status !== "signed-out" && end() : apply(session))));
      auth.getSession().then(
        ({ data: d, error }) => { if (state.status === "restoring") (error ? end(MESSAGES.restore) : apply(d.session)); },
        () => { if (state.status === "restoring") end(MESSAGES.restore); },
      );
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      if (state.status !== "signed-out" || state.pending) return;
      if (!email.trim() || !password) { set(signedOut(MESSAGES.missing)); return; }
      const mine = ++attempt, pending: AuthState = { status: "signed-out", pending: true, error: null, notice: null };
      set(pending);
      /* Still the current attempt: no newer attempt, and nothing has replaced this attempt's "signing in" state. */
      const current = () => mine === attempt && now() === pending;
      let r: Awaited<ReturnType<AuthClient["signInWithPassword"]>>;
      try { r = await auth.signInWithPassword({ email: email.trim(), password }); } catch (e) {
        if (current()) set(signedOut(isStorageFailure(e) ? MESSAGES.storage : MESSAGES.unexpected));
        return;
      }
      if (!current()) return;
      if (r.error || !r.data.session) { set(signedOut(r.error ? signInMessage(r.error) : MESSAGES.other)); return; }
      apply(r.data.session);
    },
    async signOut() {
      if (state.status === "signed-out" || state.status === "restoring") return;
      end();                                   // the account is gone from the screen before the network call
      let error: AuthError | null = null;
      try { ({ error } = await auth.signOut({ scope: "local" })); } catch (e) { error = e as AuthError; }
      if (error && now().status === "signed-out") set(signedOut(null, MESSAGES.signedOutOffline));
    },
    retry() { if (state.status === "error") void load(state.user); },
  };
}
