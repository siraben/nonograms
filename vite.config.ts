import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function stampServiceWorker() {
  return {
    name: "stamp-service-worker",
    apply: "build" as const,
    async closeBundle() {
      const outDir = resolve(process.cwd(), "dist");
      const files = (await readdir(outDir, { recursive: true }))
        .filter((file) => file !== "sw.js")
        .sort();
      const hash = createHash("sha256");
      for (const file of files) {
        const path = resolve(outDir, file);
        try {
          hash.update(file);
          hash.update(await readFile(path));
        } catch {
          // Directory entries are returned alongside files on some Node versions.
        }
      }
      const version = hash.digest("hex").slice(0, 16);
      const swPath = resolve(outDir, "sw.js");
      const source = await readFile(swPath, "utf8");
      await writeFile(swPath, source.replace("__BUILD_HASH__", version));
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  build: {
    sourcemap: false
  }
});
