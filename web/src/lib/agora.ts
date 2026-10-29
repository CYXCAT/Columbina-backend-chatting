import { randomInt, randomUUID } from "node:crypto";
import {
  Agent,
  AgoraClient,
  Area,
  DeepgramSTT,
  ExpiresIn,
  generateConvoAIToken,
  generateRtcToken,
  MiniMaxTTS,
  OpenAI,
} from "agora-agents";
import { RtmTokenBuilder } from "agora-token";
import { jwtVerify, SignJWT } from "jose";
import type { User } from "@/db/schema";
import { HttpError, requireEnv } from "./http";

const SESSION_TTL_SECONDS = 60 * 60;
const AGENT_IDLE_TIMEOUT_SECONDS = 30;
const AGENT_UID = 987_654_321;
const ISSUER = "companion-agora";
const AUDIENCE = "companion-app";

type SessionClaims = {
  userId: string;
  agentId: string;
  channel: string;
  uid: number;
};

const credentials = () => ({
  appId: requireEnv("AGORA_APP_ID").trim(),
  appCertificate: requireEnv("AGORA_APP_CERTIFICATE").trim(),
});

const signingKey = () => new TextEncoder().encode(requireEnv("JWT_SECRET"));

const client = () => {
  const { appId, appCertificate } = credentials();
  return new AgoraClient({ area: Area.US, appId, appCertificate });
};

function convoHeaders(channel: string) {
  const { appId, appCertificate } = credentials();
  const token = generateConvoAIToken({ appId, appCertificate, channelName: channel, uid: AGENT_UID, tokenExpire: SESSION_TTL_SECONDS });
  return { Authorization: `agora token=${token}` };
}

function copyFor(language: User["language"]) {
  return language === "zh"
    ? {
        instructions:
          "你是一个温暖、自然、简洁的虚拟陪伴者。用简体中文回应，除非用户明确要求其他语言。不要声称自己是人类。通常用一到三句话回答；如果用户表达危险或紧急情况，鼓励其立即联系当地紧急服务或可信任的人。",
        greeting: "你好，我在这里。今天想聊些什么？",
        failure: "抱歉，我刚才没有处理好。可以再说一次吗？",
      }
    : {
        instructions:
          "You are a warm, natural, concise virtual companion. Reply in English unless the user explicitly asks for another language. Never claim to be human. Usually answer in one to three sentences. If the user describes immediate danger or an emergency, encourage them to contact local emergency services or a trusted person now.",
        greeting: "Hi, I'm here with you. What's on your mind?",
        failure: "Sorry, I couldn't process that. Could you try again?",
      };
}

async function signSession(claims: SessionClaims) {
  return new SignJWT({ agentId: claims.agentId, channel: claims.channel, uid: claims.uid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(signingKey());
}

export async function readSession(sessionToken: string, userId: string): Promise<SessionClaims> {
  try {
    const { payload } = await jwtVerify(sessionToken, signingKey(), { issuer: ISSUER, audience: AUDIENCE });
    if (
      payload.sub !== userId ||
      typeof payload.agentId !== "string" ||
      typeof payload.channel !== "string" ||
      typeof payload.uid !== "number"
    ) {
      throw new Error("invalid claims");
    }
    return { userId, agentId: payload.agentId, channel: payload.channel, uid: payload.uid };
  } catch {
    throw new HttpError(401, "invalid Agora session");
  }
}

export async function startAgoraSession(user: User) {
  const agora = client();
  const { appId, appCertificate } = credentials();
  const uid = randomInt(1, 2_000_000_000);
  const channel = `companion-${randomUUID()}`;
  const text = copyFor(user.language);

  const agent = new Agent({
    client: agora,
    advancedFeatures: { enable_rtm: true, enable_tools: false },
    parameters: { data_channel: "rtm", enable_error_message: true },
  })
    .withStt(new DeepgramSTT({ model: "nova-3", language: user.language === "zh" ? "zh-CN" : "en-US" }))
    .withLlm(
      new OpenAI({
        model: "gpt-4.1-mini",
        maxHistory: 32,
        systemMessages: [{ role: "system", content: text.instructions }],
        greetingMessage: text.greeting,
        failureMessage: text.failure,
      }),
    )
    .withTts(new MiniMaxTTS({ model: "speech_2_6_turbo", voiceId: "English_captivating_female1" }));

  const session = agent.createSession({
    channel,
    agentUid: String(AGENT_UID),
    remoteUids: [String(uid)],
    name: `companion-${user.id}-${Date.now()}`,
    // Seconds the agent lingers after the app leaves the channel; ConvoAI bills agent time until it stops.
    idleTimeout: AGENT_IDLE_TIMEOUT_SECONDS,
    expiresIn: ExpiresIn.hours(1),
  });
  const agentId = await session.start();
  const sessionToken = await signSession({ userId: user.id, agentId, channel, uid });

  return {
    appId,
    channel,
    uid,
    agentUid: AGENT_UID,
    agentId,
    rtcToken: generateRtcToken({ appId, appCertificate, channel, uid, expirySeconds: SESSION_TTL_SECONDS }),
    rtmToken: RtmTokenBuilder.buildToken(appId, appCertificate, String(uid), SESSION_TTL_SECONDS),
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    sessionToken,
  };
}

export async function sendAgoraMessage(session: SessionClaims, text: string) {
  return client().agentManagement.agentThink(
    {
      appid: credentials().appId,
      agentId: session.agentId,
      text,
      on_listening_action: "interrupt",
      on_thinking_action: "interrupt",
      on_speaking_action: "interrupt",
      interruptable: true,
      metadata: { publisher: session.userId },
    },
    { headers: convoHeaders(session.channel) },
  );
}

export async function getAgoraHistory(session: SessionClaims) {
  return client().agents.getHistory(
    { appid: credentials().appId, agentId: session.agentId },
    { headers: convoHeaders(session.channel) },
  );
}

export async function stopAgoraSession(session: SessionClaims) {
  await client().agents.stop(
    { appid: credentials().appId, agentId: session.agentId },
    { headers: convoHeaders(session.channel) },
  );
}
