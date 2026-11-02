import { defineConfig } from "vite";

// GitHub Pages のサブパスに置けるよう、パスは相対にする（CLAUDE.md §3）
export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 5173 },
  preview: { port: 4173 },
});
