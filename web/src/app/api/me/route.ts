import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { users } from "@/db/schema";
import { publicUser, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handler, parseBody } from "@/lib/http";

const Patch = z.object({ language: z.enum(["en", "zh"]) });

export const GET = handler(async (req: Request) => NextResponse.json(publicUser(await requireUser(req))));

export const PATCH = handler(async (req: Request) => {
  const user = await requireUser(req);
  const { language } = await parseBody(req, Patch);
  const db = await getDb();
  const [updated] = await db.update(users).set({ language }).where(eq(users.id, user.id)).returning();
  return NextResponse.json(publicUser(updated));
});
