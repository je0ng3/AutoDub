import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    passWithNoTests: true,
    env: { ELEVENLABS_API_KEY: "test-key" },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["app/**", "lib/**"],
      exclude: ["app/api/auth/**"],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
