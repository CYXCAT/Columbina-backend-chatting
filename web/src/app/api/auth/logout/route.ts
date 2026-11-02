import { z } from "zod";
import { revokeRefreshToken } from "@/lib/auth";
import { handler, parseBody } from "@/lib/http";

const Body = z.object({ refreshToken: z.string().min(1) });

// Takes the refresh token rather than a bearer token: the access token may already have expired.
export const POST = handler(async (req: Request) => {
  const { refreshToken } = await parseBody(req, Body);
  await revokeRefreshToken(refreshToken);
  return new Response(null, { status: 204 });
});
