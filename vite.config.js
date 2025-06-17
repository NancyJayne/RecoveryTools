// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  root: ".", // project root
  publicDir: "public", // where static assets live (no need to change)
  build: {
    outDir: "dist", // or 'public' if you want Firebase to host directly
    emptyOutDir: true,
  },
});
