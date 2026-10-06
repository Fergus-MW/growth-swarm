import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureDevSession } from "./dev-login";

const auth = vi.hoisted(() => ({ getSession: vi.fn(), signInWithPassword: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DEV", true);
  vi.stubEnv("VITE_DEV_LOGIN_BYPASS", "true");
  vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.signInWithPassword.mockResolvedValue({ data: { session: { user: { id: "demo" } } }, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Local development login", () => {
  it.each([
    ["production", "DEV", false],
    ["disabled flag", "VITE_DEV_LOGIN_BYPASS", "false"],
    ["missing flag", "VITE_DEV_LOGIN_BYPASS", undefined],
    ["remote database", "VITE_SUPABASE_URL", "https://project.supabase.co"],
    ["misleading hostname", "VITE_SUPABASE_URL", "https://localhost.example.com"],
    ["invalid database URL", "VITE_SUPABASE_URL", "invalid"],
  ])("never signs in with %s", async (_label, key, value) => {
    if (typeof value === "boolean") vi.stubEnv("DEV", value);
    else vi.stubEnv(key, value);
    expect(await ensureDevSession()).toBe(false);
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("does not run during SSR or on a remote browser host", async () => {
    vi.stubGlobal("window", undefined);
    expect(await ensureDevSession()).toBe(false);
    vi.stubGlobal("window", { location: { hostname: "preview.example.com" } });
    expect(await ensureDevSession()).toBe(false);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("preserves an existing session", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: "another-user" } } }, error: null });
    expect(await ensureDevSession()).toBe(true);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("shares one sign-in across simultaneous route loads", async () => {
    expect(await Promise.all([ensureDevSession(), ensureDevSession()])).toEqual([true, true]);
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "demo@example.test", password: "GrowthSwarm-demo-2026!" });
  });

  it("reports failed login and allows retry", async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ data: { session: null }, error: { message: "Invalid credentials" } });
    await expect(ensureDevSession()).rejects.toThrow("npm run seed:local");
    expect(await ensureDevSession()).toBe(true);
  });
});
