import { randomBytes } from "node:crypto";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import type { User } from "@/db/schema";
import { requireEnv } from "./http";

export const AGENT_NAME = "companion";

// One fresh room per session: token-based agent dispatch only applies when the room is created.
export async function createSessionToken(user: User) {
  const roomName = `u-${user.id}-${randomBytes(6).toString("hex")}`;
  const at = new AccessToken(requireEnv("LIVEKIT_API_KEY"), requireEnv("LIVEKIT_API_SECRET"), {
    identity: user.id,
    name: user.name ?? undefined,
    ttl: "10m",
  });
  // The app only sends text (lk.chat) and receives the agent's audio + transcript: no media publishing.
  at.addGrant({ roomJoin: true, room: roomName, canPublish: false, canSubscribe: true, canPublishData: true });
  at.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: AGENT_NAME,
        metadata: JSON.stringify({ userId: user.id, language: user.language }),
      }),
    ],
  });
  return { serverUrl: requireEnv("LIVEKIT_URL"), token: await at.toJwt(), roomName };
}
