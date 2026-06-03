import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: false
  },
  preview: {
    port: 4180,
    strictPort: false
  },
  build: {
    outDir: "dist",
    sourcemap: true
  }
});
