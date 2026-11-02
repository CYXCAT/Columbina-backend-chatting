import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { issueSession, upsertUser } from "@/lib/auth";
import { handler, HttpError, parseBody } from "@/lib/http";

const Body = z.object({ name: z.string().trim().min(1).max(64) });

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// Unity Editor sign-in. Open locally with ALLOW_DEV_LOGIN=true; on a deployment it needs the
// x-dev-login-key header to match DEV_LOGIN_KEY (the key lives only on the developer's machine).
function devLoginAllowed(req: Request): boolean {
  if (process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_LOGIN === "true") return true;
  const key = process.env.DEV_LOGIN_KEY;
  const given = req.headers.get("x-dev-login-key");
  return !!key && key.length >= 32 && !!given && sameSecret(given, key);
}

export const POST = handler(async (req: Request) => {
  if (!devLoginAllowed(req)) throw new HttpError(404, "not found");
  const { name } = await parseBody(req, Body);
  const user = await upsertUser("dev", name.toLowerCase(), { name });
  return NextResponse.json(await issueSession(user));
});
