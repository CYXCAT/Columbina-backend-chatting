import { NextResponse } from "next/server";
import { z } from "zod";
import { rotateRefreshToken } from "@/lib/auth";
import { handler, parseBody } from "@/lib/http";

const Body = z.object({ refreshToken: z.string().min(1) });

export const POST = handler(async (req: Request) => {
  const { refreshToken } = await parseBody(req, Body);
  return NextResponse.json(await rotateRefreshToken(refreshToken));
});
