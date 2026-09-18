import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

test("Google sign-in requests only configured permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lockedscreen-google-permissions-"));
  try {
    const outfile = join(directory, "settings.mjs");
    await build({
      entryPoints: [fileURLToPath(new URL("../src/main/integrations/google/google-integration-settings.ts", import.meta.url))],
      bundle: true, platform: "node", format: "esm", outfile, logLevel: "silent"
    });
    const { normalizeGoogleIntegrationSettings, googleScopesToString, validateGoogleIntegrationSettings } = await import(pathToFileURL(outfile).href);
    const scopes = ["openid", "https://www.googleapis.com/auth/classroom.courses.readonly"];
    const settings = normalizeGoogleIntegrationSettings({ enabled: true, clientId: "test", requestedScopes: scopes });
    assert.deepEqual(settings.requestedScopes, scopes);
    assert.equal(googleScopesToString(settings), scopes.join(" "));
    const empty = normalizeGoogleIntegrationSettings({ ...settings, requestedScopes: [] });
    assert.equal(googleScopesToString(empty), "");
    assert.throws(() => validateGoogleIntegrationSettings(empty), /at least one requested permission/);
    assert.ok(normalizeGoogleIntegrationSettings(undefined).requestedScopes.length > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
