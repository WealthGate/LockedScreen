import { resolve } from "node:path";

import react from "@vitejs/plugin-react-swc";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { readPublisherGoogleOAuth } from "./google-oauth-build";

const bundledWorkspacePackages = [
  "@lockedscreen/shared-types",
  "@lockedscreen/storage",
  "@lockedscreen/parser",
  "@lockedscreen/exam-engine",
  "@lockedscreen/ui"
];

const edition = process.env.LOCKEDSCREEN_EDITION ?? "selectable";
if (!["student", "teacher", "selectable"].includes(edition)) {
  throw new Error("Invalid LOCKEDSCREEN_EDITION.");
}
const alias = {
  "@lockedscreen/shared-types": resolve(__dirname, "../../packages/shared-types/src"),
  "@lockedscreen/storage": resolve(__dirname, "../../packages/storage/src"),
  "@lockedscreen/parser": edition === "student"
    ? resolve(__dirname, "src/main/student-parser.ts")
    : resolve(__dirname, "../../packages/parser/src"),
  "@lockedscreen/exam-engine": resolve(__dirname, "../../packages/exam-engine/src"),
  "@lockedscreen/ui": resolve(__dirname, "../../packages/ui/src")
};

export default defineConfig({
  main: {
    define: {
      __LOCKEDSCREEN_EDITION__: JSON.stringify(edition),
      __LOCKEDSCREEN_PUBLISHER_GOOGLE_OAUTH__: JSON.stringify(
        edition === "student" ? null : readPublisherGoogleOAuth(process.env.LOCKEDSCREEN_GOOGLE_OAUTH_FILE)
      ),
      __LOCKEDSCREEN_STORE_PRODUCT_ID__: JSON.stringify(process.env.LOCKEDSCREEN_STORE_PRODUCT_ID ?? "9NRCCBKRLXBJ")
    },
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
