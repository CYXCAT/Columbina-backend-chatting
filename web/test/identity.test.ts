import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdToken = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdToken;
  },
}));

const payload = (azp: string) => ({ getPayload: () => ({ sub: "g-1", email: "a@example.com", name: "A", azp }) });

describe("verifyGoogleIdToken", () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
    vi.stubEnv("GOOGLE_CLIENT_IDS", "web-client.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_IOS_CLIENT_IDS", "ios-client.apps.googleusercontent.com");
  });

  it("checks the Web client as audience and the iOS client as azp", async () => {
    const { verifyGoogleIdToken } = await import("@/lib/identity");
    verifyIdToken.mockResolvedValue(payload("ios-client.apps.googleusercontent.com"));
    await expect(verifyGoogleIdToken("t")).resolves.toMatchObject({ sub: "g-1" });
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: "t", audience: ["web-client.apps.googleusercontent.com"] });
  });

  it("rejects tokens obtained by another client", async () => {
    const { verifyGoogleIdToken } = await import("@/lib/identity");
    verifyIdToken.mockResolvedValue(payload("someone-else.apps.googleusercontent.com"));
    await expect(verifyGoogleIdToken("t")).rejects.toMatchObject({ status: 401 });
  });

  it("rejects tokens Google's library refuses", async () => {
    const { verifyGoogleIdToken } = await import("@/lib/identity");
    verifyIdToken.mockRejectedValue(new Error("Wrong recipient"));
    await expect(verifyGoogleIdToken("t")).rejects.toMatchObject({ status: 401 });
  });
});
