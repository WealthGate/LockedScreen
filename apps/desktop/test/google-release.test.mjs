import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

test("hosted Google turn-in requires a saved active-exam submission and correct invigilator PIN", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lockedscreen-google-release-"));
  try {
    const guardFile = join(directory, "release.mjs");
    const pinFile = join(directory, "pin.mjs");
    for (const [name, outfile] of [["google-release", guardFile], ["invigilator-pin", pinFile]]) {
      await build({ entryPoints: [fileURLToPath(new URL(`../src/main/security/${name}.ts`, import.meta.url))], bundle: true, platform: "node", format: "esm", outfile, logLevel: "silent" });
    }
    const { assertGoogleRelease } = await import(pathToFileURL(guardFile).href);
    const { createPinVerifier } = await import(pathToFileURL(pinFile).href);
    const config = { id: "package", examId: "exam", quitUnlockPolicy: { pinVerifier: createPinVerifier("9876") } };
    const submission = { examId: "exam" };
    for (const pin of [undefined, "", "wrong", "2468"]) {
      assert.throws(() => assertGoogleRelease("student", config, submission, "package", pin, "2468"), /invigilator PIN/);
    }
    assert.doesNotThrow(() => assertGoogleRelease("student", config, submission, "package", "9876", "2468"));
    assert.throws(() => assertGoogleRelease("student", config, { examId: "another" }, "package", "9876", "2468"), /active exam/);
    assert.throws(() => assertGoogleRelease("teacher", config, submission, "package", "wrong", "2468"), /invigilator PIN/);
    assert.doesNotThrow(() => assertGoogleRelease("teacher", config, submission, "package", "2468", "2468"));
    const main = await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8");
    const start = main.indexOf('handleIpc("studentLms:turnIn"');
    const turnIn = main.slice(start, main.indexOf('handleIpc(', start + 10));
    assert.ok(turnIn.indexOf("assertGoogleRelease(") < turnIn.indexOf("await endManagedSession("));
    assert.ok(turnIn.indexOf("await endNativeLockdownSession(") < turnIn.indexOf("await turnInSubmissionToLms("));
    assert.match(main, /handleIpc\("lmsConnection:connect"[\s\S]*?if \(getActiveSession\(\)\) throw/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
