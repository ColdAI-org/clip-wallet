import { describe, expect, it, vi } from "vitest";
import { PLATFORM_KEYS } from "../src/platform.js";
import { SocialSignInService, type SocialBackupClientLike } from "../src/social-signin.js";

function kv() {
  const m = new Map<string, unknown>();
  return { m, get: async <T,>(k: string) => m.get(k) as T | undefined, set: async <T,>(k: string, v: T) => void m.set(k, v), remove: async (k: string) => void m.delete(k) };
}

function fakeClient(over: Partial<SocialBackupClientLike> = {}): SocialBackupClientLike {
  const c: SocialBackupClientLike = {
    session: null,
    providers: async () => ({ email: true, google: true, apple: false }),
    startSocialSignIn: vi.fn(async (provider) => ({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=s", pending: { provider, verifier: "v", state: "s", startedAt: 0 } })),
    completeSocialSignIn: vi.fn(async () => {
      c.session = { token: "t", expiresAt: 9e15 };
      return { provider: "google" as const };
    }),
    ...over,
  };
  return c;
}

describe("social sign-in (background)", () => {
  it("hides Google/Apple when this build can't open a web-auth window", async () => {
    const s = new SocialSignInService({ backup: () => fakeClient(), kv: kv(), changed: () => undefined });
    expect(await s.providers()).toEqual({ email: true, google: false, apple: false });
  });

  it("runs the flow through launchWebAuthFlow and stores the session with a plain label (no email)", async () => {
    const store = kv();
    const client = fakeClient();
    const launch = vi.fn(async () => "https://id.chromiumapp.org/backup#state=s&handoff=h");
    const changed = vi.fn();
    const s = new SocialSignInService({ backup: () => client, kv: store, launchWebAuthFlow: launch, returnUrl: "https://id.chromiumapp.org/backup", changed });
    expect(await s.providers()).toEqual({ email: true, google: true, apple: false });
    await s.handle({ type: "backupSocialSignIn", provider: "google" });
    expect(client.startSocialSignIn).toHaveBeenCalledWith("google", "https://id.chromiumapp.org/backup");
    expect(launch).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=s");
    expect(store.m.get(PLATFORM_KEYS.backupSession)).toEqual({ token: "t", expiresAt: 9e15, email: "your Google account" });
    expect(changed).toHaveBeenCalled();
  });

  it("a closed window is a plain 'cancelled', and nothing is stored", async () => {
    const store = kv();
    const s = new SocialSignInService({
      backup: () => fakeClient(),
      kv: store,
      launchWebAuthFlow: async () => {
        throw new Error("The user did not approve access.");
      },
      returnUrl: "https://id.chromiumapp.org/backup",
      changed: () => undefined,
    });
    await expect(s.signIn("google")).rejects.toMatchObject({ code: "backup/social-cancelled", userMessage: "Sign-in was cancelled." });
    expect(store.m.size).toBe(0);
  });
});
