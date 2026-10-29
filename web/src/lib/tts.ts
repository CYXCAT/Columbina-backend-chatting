import type { Language } from "@/db/schema";
import { HttpError, requireEnv } from "./http";

// Text-to-speech behind one interface so the vendor is an env choice (TTS_PROVIDER).
// Every provider yields raw 16-bit little-endian mono PCM at `sampleRate`.
export type TtsProvider = {
  name: string;
  sampleRate: number;
  synthesize(text: string, language: Language, signal: AbortSignal): AsyncIterable<Uint8Array>;
};

const env = (name: string, fallback: string) => process.env[name]?.trim() || fallback;

// TTS_VOICE_EN / TTS_VOICE_ZH override the provider's default voice per language.
const voiceFor = (language: Language, defaults: Record<Language, string>) =>
  env(language === "zh" ? "TTS_VOICE_ZH" : "TTS_VOICE_EN", defaults[language]);

const sampleRate = () => Number(env("TTS_SAMPLE_RATE", "24000"));

export function getTts(): TtsProvider {
  const provider = env("TTS_PROVIDER", "inworld");
  switch (provider) {
    case "inworld":
      return inworld();
    case "minimax":
      return minimax();
    case "openai":
      return openai();
    default:
      throw new Error(`unknown TTS_PROVIDER ${provider}`);
  }
}

// https://docs.inworld.ai — streams NDJSON lines of {result:{audioContent:<base64>}}; PCM has no WAV header.
function inworld(): TtsProvider {
  const rate = sampleRate();
  return {
    name: "inworld",
    sampleRate: rate,
    async *synthesize(text, language, signal) {
      const res = await fetch("https://api.inworld.ai/tts/v1/voice:stream", {
        method: "POST",
        signal,
        headers: { Authorization: `Basic ${requireEnv("INWORLD_API_KEY").trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voiceId: voiceFor(language, { en: "Ashley", zh: "Ashley" }),
          modelId: env("INWORLD_MODEL", "inworld-tts-2"),
          audioConfig: { audioEncoding: "PCM", sampleRateHertz: rate },
        }),
      });
      await ensureOk(res, "inworld");
      for await (const line of ndjson(res.body!)) {
        const msg = JSON.parse(line) as { result?: { audioContent?: string }; error?: { message?: string } };
        if (msg.error) throw new Error(`inworld TTS: ${msg.error.message ?? JSON.stringify(msg.error)}`);
        if (msg.result?.audioContent) yield Buffer.from(msg.result.audioContent, "base64");
      }
    },
  };
}

// https://platform.minimax.io — one request per sentence; audio comes back hex-encoded.
function minimax(): TtsProvider {
  const rate = sampleRate();
  return {
    name: "minimax",
    sampleRate: rate,
    async *synthesize(text, language, signal) {
      const res = await fetch(`${env("MINIMAX_BASE_URL", "https://api.minimax.io")}/v1/t2a_v2`, {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${requireEnv("MINIMAX_API_KEY").trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env("MINIMAX_MODEL", "speech-2.6-turbo"),
          text,
          stream: false,
          voice_setting: { voice_id: voiceFor(language, { en: "English_captivating_female1", zh: "female-shaonv" }) },
          audio_setting: { sample_rate: rate, format: "pcm", channel: 1 },
        }),
      });
      await ensureOk(res, "minimax");
      const body = (await res.json()) as { data?: { audio?: string }; base_resp?: { status_code: number; status_msg: string } };
      if (body.base_resp && body.base_resp.status_code !== 0) throw new Error(`minimax TTS: ${body.base_resp.status_msg}`);
      if (body.data?.audio) yield Buffer.from(body.data.audio, "hex");
    },
  };
}

// https://platform.openai.com/docs/guides/text-to-speech — "pcm" is fixed at 24 kHz.
function openai(): TtsProvider {
  return {
    name: "openai",
    sampleRate: 24000,
    async *synthesize(text, language, signal) {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${requireEnv("OPENAI_API_KEY").trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
          voice: voiceFor(language, { en: "coral", zh: "coral" }),
          input: text,
          response_format: "pcm",
        }),
      });
      await ensureOk(res, "openai");
      yield* alignSamples(res.body!);
    },
  };
}

async function ensureOk(res: Response, provider: string) {
  if (!res.ok) throw new HttpError(502, `${provider} TTS failed: ${res.status} ${await res.text()}`);
}

async function* ndjson(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

// Network chunks can split a 16-bit sample; carry the odd byte into the next chunk.
async function* alignSamples(body: ReadableStream<Uint8Array>) {
  let carry: Uint8Array | null = null;
  for await (const chunk of body) {
    const data: Uint8Array = carry ? Buffer.concat([carry, chunk]) : chunk;
    const even = data.length & ~1;
    carry = even < data.length ? data.subarray(even) : null;
    if (even > 0) yield data.subarray(0, even);
  }
}
