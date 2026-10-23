/* Portal mode and browser configuration: demo by default, Supabase only with a project URL and a public key. */
import { describe, expect, it } from "vitest";
import { isPublicKey, readPortalConfig } from "./config";

const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify(payload)).replace(/=+$/, "")}.sig`;
const URL_OK = "https://abcdefghijklmnopqrst.supabase.co";

describe("portal configuration", () => {
  it("is the demo unless Supabase is chosen", () => {
    expect(readPortalConfig({})).toEqual({ mode: "demo" });
    expect(readPortalConfig({ VITE_PORTAL_MODE: "demo", VITE_SUPABASE_URL: URL_OK })).toEqual({ mode: "demo" });
  });
  it("accepts the project URL with a publishable or legacy anon key", () => {
    expect(readPortalConfig({ VITE_PORTAL_MODE: "supabase", VITE_SUPABASE_URL: `${URL_OK}/`, VITE_SUPABASE_ANON_KEY: "sb_publishable_x" })).toEqual({ mode: "supabase", url: URL_OK, key: "sb_publishable_x" });
    expect(readPortalConfig({ VITE_PORTAL_MODE: "supabase", VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: jwt({ role: "anon" }) }).mode).toBe("supabase");
  });
  it("refuses, without falling back to the demo, when Supabase is misconfigured", () => {
    const bad = [
      { VITE_PORTAL_MODE: "supabse" },
      { VITE_PORTAL_MODE: "supabase", VITE_SUPABASE_URL: `${URL_OK}/rest/v1`, VITE_SUPABASE_ANON_KEY: "sb_publishable_x" },
      { VITE_PORTAL_MODE: "supabase", VITE_SUPABASE_URL: URL_OK },
      { VITE_PORTAL_MODE: "supabase", VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: "sb_secret_x" },
      { VITE_PORTAL_MODE: "supabase", VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: jwt({ role: "authenticated" }) },
    ];
    for (const env of bad) expect(readPortalConfig(env).mode, JSON.stringify(env)).toBe("invalid");
  });
  it("treats only publishable and anon keys as public", () => {
    expect(isPublicKey("sb_publishable_abc")).toBe(true);
    expect(isPublicKey(jwt({ role: "anon" }))).toBe(true);
    expect(isPublicKey("sb_secret_abc")).toBe(false);
    expect(isPublicKey(jwt({ role: "admin" }))).toBe(false);
    expect(isPublicKey("eyJnotajwt")).toBe(false);
  });
});
