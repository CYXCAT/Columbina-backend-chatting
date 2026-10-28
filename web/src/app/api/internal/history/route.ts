import { timingSafeEqual } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { messages } from "@/db/schema";
import { getDb } from "@/lib/db";
import { handler, HttpError, parseBody, requireEnv } from "@/lib/http";

// Called only by the LiveKit agent, authenticated with the shared AGENT_INTERNAL_SECRET.
function requireAgent(req: Request) {
  const expected = Buffer.from(`Bearer ${requireEnv("AGENT_INTERNAL_SECRET")}`);
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new HttpError(401, "unauthorized");
}

const Query = z.object({
  userId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const Append = z.object({
  userId: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(4000),
});

export const GET = handler(async (req: Request) => {
  requireAgent(req);
  const { userId, limit } = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const db = await getDb();
  const rows = await db
    .select({ role: messages.role, text: messages.text })
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.id))
    .limit(limit);
  return NextResponse.json({ messages: rows.reverse() });
});

export const POST = handler(async (req: Request) => {
  requireAgent(req);
  const body = await parseBody(req, Append);
  const db = await getDb();
  await db.insert(messages).values(body);
  return NextResponse.json({ ok: true });
});
