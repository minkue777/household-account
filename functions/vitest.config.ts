import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Emulator suites share one local backend. Bound file workers while keeping
    // each test's concurrent requests and transaction retry assertions intact.
    maxWorkers: process.env.FIRESTORE_EMULATOR_HOST ? 2 : undefined,
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
  },
});
