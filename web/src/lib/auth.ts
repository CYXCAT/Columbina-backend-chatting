import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { refreshTokens, users, type User } from "@/db/schema";
import { getDb } from "./db";
import { HttpError, requireEnv } from "./http";

const ISSUER = "companion";
const AUDIENCE = "companion-app";
export const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const secret = () => new TextEncoder().encode(requireEnv("JWT_SECRET"));
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; name: string | null; language: User["language"] };
};

export const publicUser = (u: User) => ({ id: u.id, name: u.name, language: u.language });

export async function upsertUser(
  provider: User["provider"],
  providerSub: string,
  profile: { email?: string | null; name?: string | null },
): Promise<User> {
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.provider, provider), eq(users.providerSub, providerSub)));
  if (existing) {
    // Apple only sends the name on the first sign-in, so never overwrite a known name with null.
    if (profile.name && !existing.name) {
      const [updated] = await db.update(users).set({ name: profile.name }).where(eq(users.id, existing.id)).returning();
      return updated;
    }
    return existing;
  }
  const [created] = await db
    .insert(users)
    .values({ provider, providerSub, email: profile.email ?? null, name: profile.name ?? null })
    .returning();
  return created;
}

export async function issueSession(user: User): Promise<AuthResponse> {
  const accessToken = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secret());

  const refreshToken = randomBytes(32).toString("base64url");
  const db = await getDb();
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });

  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS, user: publicUser(user) };
}

// Single-use rotation. Presenting an already-rotated token revokes every session of that user.
export async function rotateRefreshToken(token: string): Promise<AuthResponse> {
  const db = await getDb();
  const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(token)));
  if (!row) throw new HttpError(401, "invalid refresh token");

  if (row.revokedAt) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
    throw new HttpError(401, "refresh token reused");
  }
  if (row.expiresAt.getTime() < Date.now()) throw new HttpError(401, "refresh token expired");

  const revoked = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  if (revoked.length === 0) throw new HttpError(401, "refresh token reused");

  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  if (!user) throw new HttpError(401, "user not found");
  return issueSession(user);
}

export async function requireUser(req: Request): Promise<User> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new HttpError(401, "missing bearer token");

  let sub: string | undefined;
  try {
    ({ payload: { sub } } = await jwtVerify(token, secret(), { issuer: ISSUER, audience: AUDIENCE }));
  } catch {
    throw new HttpError(401, "invalid access token");
  }
  if (!sub) throw new HttpError(401, "invalid access token");

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, sub));
  if (!user) throw new HttpError(401, "user not found");
  return user;
}

export { sha256 };
