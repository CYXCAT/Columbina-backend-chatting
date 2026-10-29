import { NextResponse } from "next/server";
import { z } from "zod";
import { messages } from "@/db/schema";
import { readSession, sendAgoraMessage } from "@/lib/agora";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handler, parseBody } from "@/lib/http";

const Body = z.object({
  sessionToken: z.string().min(1),
  text: z.string().trim().min(1).max(4000),
});

export const runtime = "nodejs";

export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = await parseBody(req, Body);
  const session = await readSession(body.sessionToken, user.id);
  await sendAgoraMessage(session, body.text);
  await (await getDb()).insert(messages).values({ userId: user.id, role: "user", text: body.text });
  return NextResponse.json({ accepted: true });
});
