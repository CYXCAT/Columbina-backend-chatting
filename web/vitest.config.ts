import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    env: {
      PGLITE_DIR: "memory",
      JWT_SECRET: "test-secret-test-secret-test-secret-0123",
      LIVEKIT_URL: "wss://test.livekit.cloud",
      LIVEKIT_API_KEY: "APItest",
      LIVEKIT_API_SECRET: "test-livekit-secret-test-livekit-secret",
      AGENT_INTERNAL_SECRET: "agent-secret",
      GOOGLE_CLIENT_IDS: "ios-client.apps.googleusercontent.com",
      APPLE_BUNDLE_ID: "com.example.companion",
      ALLOW_DEV_LOGIN: "true",
    },
  },
});
