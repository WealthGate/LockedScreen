import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

test("hosted Google client validates browser destinations and never sends the publisher secret", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lockedscreen-hosted-client-"));
  const originalFetch = globalThis.fetch;
  try {
    const outfile = join(directory, "hosted.mjs");
    await build({ entryPoints: [fileURLToPath(new URL("../src/main/integrations/google/hosted-google-oauth.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", outfile, logLevel: "silent",
      plugins: [{ name: "test-delay", setup(builder) {
        builder.onResolve({ filter: /^node:timers\/promises$/ }, () => ({ path: "delay", namespace: "test" }));
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export async function setTimeout() {}" }));
      } }] });
    const client = await import(pathToFileURL(outfile).href);
    const flow = "f".repeat(43);
    let challenge;
    let malicious = false;
    let opened = 0;
    globalThis.fetch = async (url, init) => {
      assert.ok(String(url).startsWith("https://auth.whsdominica.com/"));
      assert.doesNotMatch(init.body, /client_secret|refresh_token/);
      const body = JSON.parse(init.body);
      if (String(url).endsWith("sign-in")) {
        challenge = body.codeChallenge;
        return Response.json({ flowId: flow, authorizeUrl: malicious ? "https://attacker.example/" : `https://auth.whsdominica.com/oauth/google/start?flow=${flow}` });
      }
      assert.match(body.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
      const { createHash } = await import("node:crypto");
      assert.equal(createHash("sha256").update(body.codeVerifier).digest("base64url"), challenge);
      return Response.json({ accessToken: "short-lived", expiresAt: new Date(Date.now() + 3600000).toISOString(), sessionToken: "s".repeat(43) });
    };
    const result = await client.beginHostedGoogleSignIn("teacher", async () => { opened++; });
    assert.equal(result.accessToken, "short-lived"); assert.equal(opened, 1);
    malicious = true;
    await assert.rejects(client.beginHostedGoogleSignIn("teacher", async () => { opened++; }), /invalid sign-in address/);
    assert.equal(opened, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
