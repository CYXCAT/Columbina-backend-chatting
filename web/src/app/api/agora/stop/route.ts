import { NextResponse } from "next/server";
import { z } from "zod";
import { readSession, stopAgoraSession } from "@/lib/agora";
import { requireUser } from "@/lib/auth";
import { handler, parseBody } from "@/lib/http";

const Body = z.object({ sessionToken: z.string().min(1) });

export const runtime = "nodejs";

export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const { sessionToken } = await parseBody(req, Body);
  await stopAgoraSession(await readSession(sessionToken, user.id));
  return NextResponse.json({ stopped: true });
});
