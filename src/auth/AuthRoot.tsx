import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useHashRoute } from "../lib/route";
import { loadAccount, type Db } from "./account";
import { AuthView, ConfigProblem } from "./AuthViews";
import type { PortalConfig } from "./config";
import { createAuthController, type AuthController } from "./session";

/* The Supabase portal: one browser client with the public key, a saved session restored on load and refreshed
   automatically, and no sign-in from links in the address bar (there are no magic links or sign-up flows). */
export function AuthRoot({ config }: { config: Exclude<PortalConfig, { mode: "demo" }> }) {
  if (config.mode === "invalid") return <ConfigProblem problem={config.problem} />;
  return <Portal url={config.url} publicKey={config.key} />;
}

function Portal({ url, publicKey }: { url: string; publicKey: string }) {
  const controller = useMemo<AuthController>(() => {
    const sb = createClient(url, publicKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    return createAuthController(sb.auth, (userId) => loadAccount(sb as unknown as Db, userId));
  }, [url, publicKey]);
  useEffect(() => controller.start(), [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const route = useHashRoute();
  return <AuthView state={state} route={route} actions={{ signIn: controller.signIn, signOut: controller.signOut, retry: controller.retry }} />;
}
