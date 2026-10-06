import { supabase } from "@/integrations/supabase/client";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isDevLoginEnabled(): boolean {
  if (!import.meta.env.DEV || import.meta.env["VITE_DEV_LOGIN_BYPASS"] !== "true") return false;
  if (typeof window === "undefined" || !LOOPBACK.has(window.location.hostname)) return false;
  try {
    return LOOPBACK.has(new URL(import.meta.env["VITE_SUPABASE_URL"]).hostname);
  } catch {
    return false;
  }
}

let signingIn: Promise<boolean> | undefined;

/** Obtain a real local session so API authentication and row-level security still apply. */
export async function ensureDevSession(): Promise<boolean> {
  if (!isDevLoginEnabled()) return false;
  if (!signingIn) {
    signingIn = (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (data.session) return true;
      const login = await supabase.auth.signInWithPassword({
        email: "demo@example.test",
        password: "GrowthSwarm-demo-2026!",
      });
      if (login.error || !login.data.session) {
        throw new Error("Local demo login failed. Start local Supabase and run npm run seed:local.");
      }
      return true;
    })().finally(() => { signingIn = undefined; });
  }
  return signingIn;
}
