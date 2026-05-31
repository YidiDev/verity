import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.test.{js,ts}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
    },
    // Each test file gets a fresh module scope, but we need to reset
    // the global DLCore singleton between tests
    restoreMocks: true,
  },
});
