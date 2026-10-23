/* Which portal runs: the fictional demo (default) or the Supabase-backed portal. Chosen at build time from .env.local:
     VITE_PORTAL_MODE=supabase, VITE_SUPABASE_URL=https://<project-ref>.supabase.co, VITE_SUPABASE_ANON_KEY=<public key>
   Only the public key may be given to the browser. A Supabase mode that is misconfigured is reported as such; it never
   falls back to the demo and its fictional data. */
export type PortalConfig =
  | { mode: "demo" }
  | { mode: "supabase"; url: string; key: string }
  | { mode: "invalid"; problem: string };

type Env = Record<string, unknown> & { VITE_PORTAL_MODE?: string; VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string };

const payloadRole = (jwt: string): string | null => {
  try {
    const p = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return (JSON.parse(atob(p.padEnd(p.length + ((4 - (p.length % 4)) % 4), "="))) as { role?: unknown }).role as string ?? null;
  } catch { return null; }
};

/** A publishable key, or a legacy key whose role is anon. Anything else (a secret key, any other role) is refused. */
export const isPublicKey = (key: string) =>
  key.startsWith("sb_publishable_") || (key.startsWith("eyJ") && payloadRole(key) === "anon");

export function readPortalConfig(env: Env): PortalConfig {
  const mode = (env.VITE_PORTAL_MODE ?? "").trim() || "demo";
  if (mode === "demo") return { mode: "demo" };
  if (mode !== "supabase") return { mode: "invalid", problem: `VITE_PORTAL_MODE is "${mode}"; use "demo" or "supabase".` };
  const url = (env.VITE_SUPABASE_URL ?? "").trim().replace(/\/$/, ""), key = (env.VITE_SUPABASE_ANON_KEY ?? "").trim();
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) return { mode: "invalid", problem: "VITE_SUPABASE_URL should be the project URL, https://<project-ref>.supabase.co." };
  if (!key) return { mode: "invalid", problem: "VITE_SUPABASE_ANON_KEY is empty." };
  if (!isPublicKey(key)) return { mode: "invalid", problem: "VITE_SUPABASE_ANON_KEY is not a public (publishable or anon) key. Never give the browser a secret key." };
  return { mode: "supabase", url, key };
}
