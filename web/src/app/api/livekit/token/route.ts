import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/http";
import { createSessionToken } from "@/lib/livekit";

export const POST = handler(async (req: Request) => NextResponse.json(await createSessionToken(await requireUser(req))));
