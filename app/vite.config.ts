import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure Vite runs from the app directory even when invoked from repo root.
const appRoot = __dirname;
const repoRoot = resolve(appRoot, "..");

export default defineConfig({
  root: appRoot,
  // Load env files from the repo root so .env.local works for both client and server.
  envDir: repoRoot,
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    outDir: resolve(appRoot, "dist"),
    emptyOutDir: true,
  },
});
