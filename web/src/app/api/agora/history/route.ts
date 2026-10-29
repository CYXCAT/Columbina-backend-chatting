import { NextResponse } from "next/server";
import { z } from "zod";
import { getAgoraHistory, readSession } from "@/lib/agora";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/http";

const Query = z.object({ sessionToken: z.string().min(1) });

export const runtime = "nodejs";

export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const { sessionToken } = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const session = await readSession(sessionToken, user.id);
  const history = await getAgoraHistory(session);
  return NextResponse.json({ messages: history.contents ?? [] });
});
