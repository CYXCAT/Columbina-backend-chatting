import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { startAgoraSession } from "@/lib/agora";
import { handler } from "@/lib/http";

export const runtime = "nodejs";

export const POST = handler(async (req: Request) => NextResponse.json(await startAgoraSession(await requireUser(req))));
