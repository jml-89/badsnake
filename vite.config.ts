/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the static build works when served from a
  // GitHub Pages project subpath (e.g. /badsnake/).
  base: "./",
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
