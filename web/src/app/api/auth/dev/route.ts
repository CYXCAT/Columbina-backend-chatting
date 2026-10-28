import { NextResponse } from "next/server";
import { z } from "zod";
import { issueSession, upsertUser } from "@/lib/auth";
import { handler, HttpError, parseBody } from "@/lib/http";

const Body = z.object({ name: z.string().trim().min(1).max(64) });

// Local development only (Unity Editor): never enabled in production builds.
export const POST = handler(async (req: Request) => {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEV_LOGIN !== "true")
    throw new HttpError(404, "not found");
  const { name } = await parseBody(req, Body);
  const user = await upsertUser("dev", name.toLowerCase(), { name });
  return NextResponse.json(await issueSession(user));
});
