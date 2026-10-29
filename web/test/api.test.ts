import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db";

vi.mock("@/lib/identity", () => ({
  verifyGoogleIdToken: vi.fn(async (t: string) => {
    if (t !== "good-google") {
      const { HttpError } = await import("@/lib/http");
      throw new HttpError(401, "invalid Google ID token");
    }
    return { sub: "g-123", email: "a@example.com", name: "Alice" };
  }),
  verifyAppleIdentityToken: vi.fn(),
}));

vi.mock("@/lib/agora", () => ({
  startAgoraSession: vi.fn(async (user: { id: string; language: string }) => ({
    appId: "test-app-id",
    channel: `companion-${user.id}`,
    uid: 123,
    agentUid: 456,
    agentId: "agent-1",
    rtcToken: "rtc-token",
    rtmToken: "rtm-token",
    expiresAt: 123456789,
    sessionToken: `session-${user.id}-${user.language}`,
  })),
}));

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://test/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function devLogin(name = "Tester") {
  const { POST } = await import("@/app/api/auth/dev/route");
  const res = await POST(post({ name }));
  expect(res.status).toBe(200);
  return res.json();
}

beforeEach(() => {
  resetDbForTests();
  vi.unstubAllEnvs();
});

describe("auth", () => {
  it("dev login is refused when disabled", async () => {
    vi.stubEnv("ALLOW_DEV_LOGIN", "false");
    const { POST } = await import("@/app/api/auth/dev/route");
    expect((await POST(post({ name: "x" }))).status).toBe(404);
  });

  it("dev login is refused in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { POST } = await import("@/app/api/auth/dev/route");
    expect((await POST(post({ name: "x" }))).status).toBe(404);
  });

  it("google sign-in creates the user once and issues a session", async () => {
    const { POST } = await import("@/app/api/auth/google/route");
    const a = await (await POST(post({ idToken: "good-google" }))).json();
    const b = await (await POST(post({ idToken: "good-google" }))).json();
    expect(a.user.id).toBe(b.user.id);
    expect(a.user.name).toBe("Alice");
    expect(a.accessToken).toBeTruthy();
    expect((await POST(post({ idToken: "bad" }))).status).toBe(401);
  });

  it("refresh tokens rotate and reuse revokes the family", async () => {
    const { POST } = await import("@/app/api/auth/refresh/route");
    const s0 = await devLogin();
    const r1 = await POST(post({ refreshToken: s0.refreshToken }));
    expect(r1.status).toBe(200);
    const s1 = await r1.json();
    expect(s1.refreshToken).not.toBe(s0.refreshToken);

    // replaying the old token is rejected and also kills the newer one
    expect((await POST(post({ refreshToken: s0.refreshToken }))).status).toBe(401);
    expect((await POST(post({ refreshToken: s1.refreshToken }))).status).toBe(401);
  });
});

describe("me", () => {
  it("requires a valid bearer token and validates language", async () => {
    const { GET, PATCH } = await import("@/app/api/me/route");
    expect((await GET(new Request("http://test/api/me"))).status).toBe(401);

    const s = await devLogin();
    const me = await (await GET(new Request("http://test/api/me", { headers: bearer(s.accessToken) }))).json();
    expect(me.language).toBe("en");

    const patch = (language: string) =>
      PATCH(new Request("http://test/api/me", { method: "PATCH", headers: bearer(s.accessToken), body: JSON.stringify({ language }) }));
    expect((await (await patch("zh")).json()).language).toBe("zh");
    expect((await patch("fr")).status).toBe(400);
  });
});

describe("Agora session", () => {
  it("starts a session for the authenticated user with their language", async () => {
    const s = await devLogin();
    const { PATCH } = await import("@/app/api/me/route");
    await PATCH(new Request("http://test/api/me", { method: "PATCH", headers: bearer(s.accessToken), body: JSON.stringify({ language: "zh" }) }));

    const { POST } = await import("@/app/api/agora/session/route");
    const res = await POST(post({}, bearer(s.accessToken)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channel).toBe(`companion-${s.user.id}`);
    expect(body.sessionToken).toBe(`session-${s.user.id}-zh`);
    expect(body.rtcToken).toBeTruthy();
    expect(body.rtmToken).toBeTruthy();
  });

  it("rejects anonymous callers", async () => {
    const { POST } = await import("@/app/api/agora/session/route");
    expect((await POST(post({}))).status).toBe(401);
  });
});

describe("internal history", () => {
  it("is agent-only and returns messages oldest first", async () => {
    const s = await devLogin();
    const { GET, POST } = await import("@/app/api/internal/history/route");
    const agent = bearer("agent-secret");

    expect((await POST(post({ userId: s.user.id, role: "user", text: "hi" }, bearer("wrong")))).status).toBe(401);
    await POST(post({ userId: s.user.id, role: "user", text: "hi" }, agent));
    await POST(post({ userId: s.user.id, role: "assistant", text: "hello!" }, agent));

    const res = await GET(new Request(`http://test/api/internal/history?userId=${s.user.id}&limit=10`, { headers: agent }));
    expect((await res.json()).messages).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "hello!" },
    ]);
  });
});
