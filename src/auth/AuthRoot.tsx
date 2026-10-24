import { createClient } from "@supabase/supabase-js";
import { useEffect, useSyncExternalStore } from "react";
import { useHashRoute } from "../lib/route";
import { loadAccount, type Db } from "./account";
import { AuthView, ConfigProblem } from "./AuthViews";
import type { PortalConfig } from "./config";
import { createAuthController, type AuthController } from "./session";
import { loadWorkspace, type WorkspaceDb } from "../workspace/data";
import { createWorkspaceController, keyOf, type WorkspaceController } from "../workspace/store";
import { createMoveController, supabaseMoveRpc, type MoveController, type MoveRecordEntry, type RpcClient } from "../workspace/moves";

/* The Supabase portal: one browser client with the public key, a saved session restored on load and refreshed
   automatically, and no sign-in from links in the address bar (there are no magic links or sign-up flows). */
export function AuthRoot({ config }: { config: Exclude<PortalConfig, { mode: "demo" }> }) {
  if (config.mode === "invalid") return <ConfigProblem problem={config.problem} />;
  return <Portal url={config.url} publicKey={config.key} />;
}

/* One client per page, created outside React: StrictMode renders twice in development, and two clients sharing one saved
   session would refresh it independently.
   The workspace data follows the session outside React too, so a sign-out or account change clears it in the same step. */
/* Development only: the test-run recorder of the Vite dev server (scripts/dev/move-recorder-plugin.mjs), switched on with
   VITE_DEV_RECORD_MOVES=true. A production build never records. The entry holds no session token or password. */
const DEV_RECORDING = import.meta.env.DEV && import.meta.env.VITE_DEV_RECORD_MOVES === "true";
async function recordToDevServer(entry: MoveRecordEntry) {
  const r = await fetch("/__dev/move-record", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) });
  if (r.status !== 204) throw new Error(`move record not saved (HTTP ${r.status})`);
}

const controllers = new Map<string, { auth: AuthController; data: WorkspaceController; moves: MoveController }>();
function controllersFor(url: string, publicKey: string) {
  const id = `${url} ${publicKey}`;
  let c = controllers.get(id);
  if (!c) {
    const sb = createClient(url, publicKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    const auth = createAuthController(sb.auth, (userId) => loadAccount(sb as unknown as Db, userId));
    const data = createWorkspaceController((clientId) => loadWorkspace(sb as unknown as WorkspaceDb, clientId));
    const moves = createMoveController(supabaseMoveRpc(sb as unknown as RpcClient), () => data.refresh(), DEV_RECORDING ? { record: recordToDevServer } : {});
    auth.subscribe(() => {
      const s = auth.getState(), account = s.status === "ready" ? { userId: s.user.id, clientId: s.client.id } : null;
      moves.sync(account && keyOf(account));
      data.sync(account);
    });
    c = { auth, data, moves };
    controllers.set(id, c);
  }
  return c;
}

function Portal({ url, publicKey }: { url: string; publicKey: string }) {
  const { auth, data, moves } = controllersFor(url, publicKey);
  useEffect(() => auth.start(), [auth]);
  const state = useSyncExternalStore(auth.subscribe, auth.getState);
  const workspace = useSyncExternalStore(data.subscribe, data.getState);
  const move = useSyncExternalStore(moves.subscribe, moves.getState);
  const account = state.status === "ready" ? keyOf({ userId: state.user.id, clientId: state.client.id }) : "";
  const route = useHashRoute();
  return <AuthView state={state} route={route} actions={{ signIn: auth.signIn, signOut: auth.signOut, retry: auth.retry }} workspace={{ state: workspace, retry: data.retry, moves: { state: move, retry: moves.retry, dismiss: moves.dismiss,
      move: (sub, to, seen) => moves.move(account, { id: sub.id, version: seen.version, stage: seen.stage }, to) }, devRecording: DEV_RECORDING }} />;
}
