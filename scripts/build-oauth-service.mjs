import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  entryPoints: [fileURLToPath(new URL("../services/google-oauth/src/index.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("../services/google-oauth/dist/worker.js", import.meta.url)),
  bundle: true, platform: "browser", format: "esm", target: "es2022", legalComments: "eof"
});
