import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";

import { build } from "esbuild";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const bundleDirectory = await mkdtemp(join(tmpdir(), "lockedscreen-storage-tests-"));
const bundlePath = join(bundleDirectory, "storage.mjs");

await build({
  entryPoints: [resolve(testDirectory, "../src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile: bundlePath,
  logLevel: "silent"
});

const { createStorageService } = await import(pathToFileURL(bundlePath).href);

after(async () => {
  await rm(bundleDirectory, { recursive: true, force: true });
});

const withDataDirectory = async (operation) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "lockedscreen-storage-data-"));
  try {
    await operation(dataDirectory);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
};

test("restores the last good backup when the live state is truncated", async () => {
  await withDataDirectory(async (dataDirectory) => {
    const storage = createStorageService(dataDirectory);
    const initial = await storage.getSnapshot();
    const first = await storage.saveSettings({ ...initial.settings, adminUnlockPin: "1111" });
    await storage.saveSettings({ ...first.settings, adminUnlockPin: "2222" });

    const statePath = join(dataDirectory, "lockedscreen-state.json");
    await writeFile(statePath, "{", "utf-8");

    const recovered = await storage.getSnapshot();
    assert.equal(recovered.settings.adminUnlockPin, "1111");
    assert.match(recovered.securityLogs[0]?.message ?? "", /automatic local backup/i);

    const repairedContent = await readFile(statePath, "utf-8");
    assert.doesNotThrow(() => JSON.parse(repairedContent));
    assert.equal(await readFile(`${statePath}.corrupt.json`, "utf-8"), "{");
  });
});

test("repairs valid state followed by interrupted-write residue", async () => {
  await withDataDirectory(async (dataDirectory) => {
    const storage = createStorageService(dataDirectory);
    const snapshot = await storage.getSnapshot();
    const statePath = join(dataDirectory, "lockedscreen-state.json");
    const damagedContent = `${JSON.stringify(snapshot)}\nPARTIAL_WRITE`;
    await writeFile(statePath, damagedContent, "utf-8");

    const recovered = await storage.getSnapshot();
    assert.equal(recovered.exams.length, snapshot.exams.length);
    assert.match(recovered.securityLogs[0]?.message ?? "", /interrupted local storage write/i);

    const repairedContent = await readFile(statePath, "utf-8");
    assert.doesNotThrow(() => JSON.parse(repairedContent));
  });
});

test("starts with a valid default state when an empty file has no backup", async () => {
  await withDataDirectory(async (dataDirectory) => {
    const statePath = join(dataDirectory, "lockedscreen-state.json");
    await writeFile(statePath, "", "utf-8");

    const storage = createStorageService(dataDirectory);
    const recovered = await storage.getSnapshot();

    assert.ok(recovered.exams.length > 0);
    assert.match(recovered.securityLogs[0]?.message ?? "", /was unreadable and was reset/i);
    const repairedContent = await readFile(statePath, "utf-8");
    assert.doesNotThrow(() => JSON.parse(repairedContent));
  });
});

test("serializes simultaneous updates without dropping state", async () => {
  await withDataDirectory(async (dataDirectory) => {
    const storage = createStorageService(dataDirectory);
    const messages = Array.from({ length: 24 }, (_, index) => `Concurrent storage update ${index + 1}`);

    await Promise.all(
      messages.map((message) =>
        storage.appendSecurityLog({
          category: "application",
          severity: "info",
          message
        })
      )
    );

    const snapshot = await storage.getSnapshot();
    const storedMessages = new Set(snapshot.securityLogs.map((entry) => entry.message));
    for (const message of messages) {
      assert.equal(storedMessages.has(message), true, `Missing serialized update: ${message}`);
    }

    const statePath = join(dataDirectory, "lockedscreen-state.json");
    const content = await readFile(statePath, "utf-8");
    assert.doesNotThrow(() => JSON.parse(content));
  });
});
