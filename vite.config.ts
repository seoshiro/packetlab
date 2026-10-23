import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
let sha = process.env.GITHUB_SHA || "development";
try {
  sha =
    process.env.GITHUB_SHA ||
    execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
} catch {
  /* Local uncommitted preview. */
}
export default defineConfig({
  plugins: [react()],
  base: "./",
  define: { __BUILD_SHA__: JSON.stringify(sha) },
  test: { include: ["tests/**/*.test.ts"], maxWorkers: 1 },
});
