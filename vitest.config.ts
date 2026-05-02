import { resolve } from "node:path";

export default {
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./packages/core/src"),
      "@ccrelay/core": resolve(__dirname, "./packages/core/src/index.ts"),
    },
  },
};
