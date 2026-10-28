import { NextResponse } from "next/server";
import { z } from "zod";
import { issueSession, upsertUser } from "@/lib/auth";
import { handler, parseBody } from "@/lib/http";
import { verifyAppleIdentityToken } from "@/lib/identity";

const Body = z.object({
  idToken: z.string().min(1),
  nonce: z.string().min(16),
  name: z.string().trim().max(128).optional(),
});

export const POST = handler(async (req: Request) => {
  const { idToken, nonce, name } = await parseBody(req, Body);
  const id = await verifyAppleIdentityToken(idToken, nonce);
  const user = await upsertUser("apple", id.sub, { email: id.email, name: name || null });
  return NextResponse.json(await issueSession(user));
});
