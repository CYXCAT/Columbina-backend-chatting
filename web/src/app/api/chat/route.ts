import { streamText } from "ai";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { type Language, messages } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { handler, parseBody } from "@/lib/http";
import { getLlm } from "@/lib/llm";
import { personaFor } from "@/lib/persona";
import { SentenceSplitter } from "@/lib/sentences";
import { getTts, type TtsProvider } from "@/lib/tts";

const HISTORY_LIMIT = 20;

// Either a user message, or `greeting: true` to have the character say hello (not stored).
const Body = z.union([
  z.object({ text: z.string().trim().min(1).max(4000) }),
  z.object({ greeting: z.literal(true) }),
]);

// The response is NDJSON, one event per line:
//   {"t":"start","sampleRate":24000}
//   {"t":"text","text":"<reply so far, sentence by sentence, sent just before that sentence's audio>"}
//   {"t":"audio","pcm":"<base64 16-bit LE mono PCM>"}
//   {"t":"error","message":"..."}         (non-fatal: e.g. TTS failed, the text still arrives)
//   {"t":"done","text":"<full reply>"}
// Closing the connection cancels the LLM and TTS requests (how the app interrupts her).
type Event =
  | { t: "start"; sampleRate: number }
  | { t: "text"; text: string }
  | { t: "audio"; pcm: string }
  | { t: "error"; message: string }
  | { t: "done"; text: string };

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = await parseBody(req, Body);
  const tts = getTts();
  const persona = personaFor(user.language);
  const db = await getDb();

  let history: { role: "user" | "assistant"; content: string }[] = [];
  if ("text" in body) {
    const rows = await db
      .select({ role: messages.role, content: messages.text })
      .from(messages)
      .where(eq(messages.userId, user.id))
      .orderBy(desc(messages.id))
      .limit(HISTORY_LIMIT);
    history = rows.reverse();
    await db.insert(messages).values({ userId: user.id, role: "user", text: body.text });
  }

  const cancel = new AbortController();
  const signal = AbortSignal.any([req.signal, cancel.signal]);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Event) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // The client went away; `signal` stops the remaining work.
        }
      };
      send({ t: "start", sampleRate: tts.sampleRate });

      const sentences = new Queue<string>();
      const spoken = speak(sentences, tts, user.language, signal, send);
      let reply = "";
      let failed = false;
      let llmError: unknown;

      if ("greeting" in body) {
        reply = persona.greeting;
        sentences.push(reply);
      } else {
        try {
          const result = streamText({
            ...getLlm(user.id),
            instructions: persona.instructions,
            messages: [...history, { role: "user", content: body.text }],
            abortSignal: signal,
            // textStream ends quietly on a model error instead of throwing.
            onError: ({ error }) => {
              llmError = error;
            },
          });
          const splitter = new SentenceSplitter();
          for await (const delta of result.textStream) {
            reply += delta;
            for (const s of splitter.push(delta)) sentences.push(s);
          }
          for (const s of splitter.flush()) sentences.push(s);
          if (llmError) throw llmError;
        } catch (e) {
          if (!signal.aborted) console.error(e);
          failed = true;
          if (!reply && !signal.aborted) sentences.push(persona.failure);
        }
      }
      sentences.close();
      const shown = await spoken;

      // Keep what she actually said, even if she was interrupted, so the next turn has context.
      if ("text" in body && reply.trim() && !failed) {
        await db.insert(messages).values({ userId: user.id, role: "assistant", text: reply.trim() });
      }
      send({ t: "done", text: shown });
      try {
        controller.close();
      } catch {
        // already cancelled
      }
    },
    cancel() {
      cancel.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
});

// Synthesizes sentences one after another (while the LLM keeps generating) so audio stays in order.
// Returns the text that was shown.
async function speak(
  sentences: Queue<string>,
  tts: TtsProvider,
  language: Language,
  signal: AbortSignal,
  send: (event: Event) => void,
) {
  const separator = language === "zh" ? "" : " ";
  let shown = "";
  for await (const sentence of sentences) {
    if (signal.aborted) break;
    shown = shown ? shown + separator + sentence : sentence;
    send({ t: "text", text: shown });
    try {
      for await (const pcm of tts.synthesize(sentence, language, signal)) {
        send({ t: "audio", pcm: Buffer.from(pcm).toString("base64") });
      }
    } catch (e) {
      if (signal.aborted) break;
      console.error(e);
      send({ t: "error", message: "speech synthesis failed" });
    }
  }
  return shown;
}

// Minimal single-consumer async queue.
class Queue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private closed = false;
  private wake: (() => void) | null = null;

  push(item: T) {
    this.items.push(item);
    this.wake?.();
  }

  close() {
    this.closed = true;
    this.wake?.();
  }

  async *[Symbol.asyncIterator]() {
    for (;;) {
      if (this.items.length) yield this.items.shift()!;
      else if (this.closed) return;
      else await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }
}
