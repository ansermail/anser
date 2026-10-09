import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
export default defineConfig(({ mode }) => ({
  root: mode === "preview" ? path.resolve(__dirname, "preview") : __dirname,
  base: mode === "preview" ? "/anser/" : "/",
  publicDir: path.resolve(__dirname, "public"),
  build: {
    outDir: path.resolve(
      __dirname,
      mode === "preview" ? "dist-preview" : "dist",
    ),
    emptyOutDir: true,
  },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  clearScreen: false,
}));
