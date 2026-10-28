import { OAuth2Client } from "google-auth-library";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { HttpError, requireEnv } from "./http";
import { sha256 } from "./auth";

export type VerifiedIdentity = { sub: string; email: string | null; name: string | null };

const google = new OAuth2Client();

// The iOS app signs in with GIDServerClientID set, so the token's aud is our Web client ID and its
// azp is the iOS client. verifyIdToken checks signature, aud, exp and iss (accounts.google.com).
export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedIdentity> {
  const audience = requireEnv("GOOGLE_CLIENT_IDS").split(",").map((s) => s.trim());
  const iosClients = (process.env.GOOGLE_IOS_CLIENT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const ticket = await google.verifyIdToken({ idToken, audience });
    const p = ticket.getPayload();
    if (!p?.sub) throw new Error("no sub");
    if (iosClients.length > 0 && !iosClients.includes(p.azp ?? "")) throw new Error("unexpected azp");
    return { sub: p.sub, email: p.email ?? null, name: p.name ?? null };
  } catch {
    throw new HttpError(401, "invalid Google ID token");
  }
}

const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

// The app sends the raw nonce; Apple embeds sha256(rawNonce) in the identity token.
export async function verifyAppleIdentityToken(identityToken: string, rawNonce: string): Promise<VerifiedIdentity> {
  try {
    const { payload } = await jwtVerify(identityToken, appleKeys, {
      issuer: "https://appleid.apple.com",
      audience: requireEnv("APPLE_BUNDLE_ID"),
    });
    if (!payload.sub || payload.nonce !== sha256(rawNonce)) throw new Error("nonce mismatch");
    return { sub: payload.sub, email: (payload.email as string | undefined) ?? null, name: null };
  } catch {
    throw new HttpError(401, "invalid Apple identity token");
  }
}
