import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from GitHub Pages at /shoal/, which the hub also auto-detects as the demo.
export default defineConfig({
  base: "/shoal/",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
