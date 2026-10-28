import { NextResponse } from "next/server";
import { z } from "zod";
import { issueSession, upsertUser } from "@/lib/auth";
import { handler, parseBody } from "@/lib/http";
import { verifyGoogleIdToken } from "@/lib/identity";

const Body = z.object({ idToken: z.string().min(1) });

export const POST = handler(async (req: Request) => {
  const { idToken } = await parseBody(req, Body);
  const id = await verifyGoogleIdToken(idToken);
  const user = await upsertUser("google", id.sub, id);
  return NextResponse.json(await issueSession(user));
});
