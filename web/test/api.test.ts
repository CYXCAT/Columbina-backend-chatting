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

vi.mock("ai", () => ({
  streamText: vi.fn(() => ({
    textStream: (async function* () {
      yield "Hi there, ";
      yield "nice to see you. How was";
      yield " your day?";
    })(),
  })),
}));

vi.mock("@/lib/llm", () => ({ getLlm: () => ({ model: "test-model" }) }));

vi.mock("@/lib/tts", () => ({
  getTts: () => ({
    name: "fake",
    sampleRate: 16000,
    async *synthesize(text: string) {
      yield new Uint8Array(text.length * 2);
    },
  }),
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

describe("chat", () => {
  const events = async (res: Response) =>
    (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

  it("streams sentence text with audio and stores both turns", async () => {
    const s = await devLogin();
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(post({ text: "hello" }, bearer(s.accessToken)));
    expect(res.status).toBe(200);
    const ev = await events(res);

    expect(ev[0]).toEqual({ t: "start", sampleRate: 16000 });
    expect(ev.filter((e) => e.t === "text").map((e) => e.text)).toEqual([
      "Hi there, nice to see you.",
      "Hi there, nice to see you. How was your day?",
    ]);
    expect(ev.filter((e) => e.t === "audio")).toHaveLength(2);
    expect(ev.at(-1)).toEqual({ t: "done", text: "Hi there, nice to see you. How was your day?" });

    const { getDb } = await import("@/lib/db");
    const { messages } = await import("@/db/schema");
    const rows = await (await getDb()).select({ role: messages.role, text: messages.text }).from(messages);
    expect(rows).toEqual([
      { role: "user", text: "hello" },
      { role: "assistant", text: "Hi there, nice to see you. How was your day?" },
    ]);
  });

  it("speaks the greeting without storing it", async () => {
    const s = await devLogin();
    const { POST } = await import("@/app/api/chat/route");
    const ev = await events(await POST(post({ greeting: true }, bearer(s.accessToken))));
    expect(ev.at(-1)).toEqual({ t: "done", text: "Hi, I'm here with you. What's on your mind?" });

    const { getDb } = await import("@/lib/db");
    const { messages } = await import("@/db/schema");
    expect(await (await getDb()).select().from(messages)).toEqual([]);
  });

  it("rejects anonymous callers and empty messages", async () => {
    const s = await devLogin();
    const { POST } = await import("@/app/api/chat/route");
    expect((await POST(post({ text: "hi" }))).status).toBe(401);
    expect((await POST(post({ text: "  " }, bearer(s.accessToken)))).status).toBe(400);
  });
});

describe("sentence splitter", () => {
  it("splits on sentence ends, keeps decimals and merges short fragments", async () => {
    const { SentenceSplitter } = await import("@/lib/sentences");
    const sp = new SentenceSplitter();
    expect(sp.push("Pi is 3.14 roughly. Ok! ")).toEqual(["Pi is 3.14 roughly."]);
    expect(sp.push("你好呀。今天天气不错！还")).toEqual(["Ok! 你好呀。", "今天天气不错！"]);
    expect(sp.flush()).toEqual(["还"]);
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
