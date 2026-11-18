import { defineConfig } from "vitest/config";

// L1 (tests/unit), L2 (tests/contract) and L3 (tests/integration); each has its
// own npm script so a level can run alone.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/contract/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
  },
});
