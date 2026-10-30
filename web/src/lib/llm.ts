import { createDeepSeek } from "@ai-sdk/deepseek";
import type { streamText } from "ai";
import { requireEnv } from "./http";

type ModelOptions = Pick<Parameters<typeof streamText>[0], "model" | "providerOptions">;

const env = (name: string) => process.env[name]?.trim() || undefined;

// The chat model behind one switch (LLM_PROVIDER) so the vendor is an env choice.
export function getLlm(userId: string): ModelOptions {
  const provider = env("LLM_PROVIDER") ?? "deepseek";
  switch (provider) {
    case "deepseek":
      return {
        model: createDeepSeek({ apiKey: requireEnv("DEEPSEEK_API_KEY").trim() })(env("LLM_MODEL") ?? "deepseek-flash"),
        // Thinking mode adds seconds before the first word; a spoken companion needs a fast reply.
        providerOptions: { deepseek: { thinking: { type: "disabled" }, userId } },
      };
    case "gateway":
      // Vercel AI Gateway: any "<provider>/<model>" id; authenticates with OIDC on Vercel.
      return { model: env("LLM_MODEL") ?? "openai/gpt-4.1-mini" };
    default:
      throw new Error(`unknown LLM_PROVIDER ${provider}`);
  }
}
