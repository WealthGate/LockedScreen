import { resolve } from "node:path";

import react from "@vitejs/plugin-react-swc";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const bundledWorkspacePackages = [
  "@lockedscreen/shared-types",
  "@lockedscreen/storage",
  "@lockedscreen/parser",
  "@lockedscreen/exam-engine",
  "@lockedscreen/ui"
];

const alias = {
  "@lockedscreen/shared-types": resolve(__dirname, "../../packages/shared-types/src"),
  "@lockedscreen/storage": resolve(__dirname, "../../packages/storage/src"),
  "@lockedscreen/parser": resolve(__dirname, "../../packages/parser/src"),
  "@lockedscreen/exam-engine": resolve(__dirname, "../../packages/exam-engine/src"),
  "@lockedscreen/ui": resolve(__dirname, "../../packages/ui/src")
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspacePackages })],
    resolve: { alias }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspacePackages })],
    resolve: { alias },
    build: {
      rollupOptions: {
        output: {
          entryFileNames: "index.cjs",
          format: "cjs"
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias }
  }
});
