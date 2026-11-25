import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rmdir, readFile, rm, writeFile } from "node:fs/promises";
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

test("Google permissions remain administrator-selected after saving and reopening", async () => {
  await withDataDirectory(async (dataDirectory) => {
    const storage = createStorageService(dataDirectory);
    const initial = await storage.getSnapshot();
    for (const requestedScopes of [["openid", "https://www.googleapis.com/auth/classroom.courses.readonly"], []]) {
      const saved = await storage.saveSettings({
        ...initial.settings,
        googleIntegration: { ...initial.settings.googleIntegration, requestedScopes }
      });
      assert.deepEqual(saved.settings.googleIntegration.requestedScopes, requestedScopes);
      const reopened = await createStorageService(dataDirectory).getSnapshot();
      assert.deepEqual(reopened.settings.googleIntegration.requestedScopes, requestedScopes);
    }
  });
});

test("fresh installs use hosted Google without a local publisher secret and hosted packages strip secrets", async () => {
  await withDataDirectory(async (dataDirectory) => {
    const storage = createStorageService(dataDirectory);
    const initial = await storage.getSnapshot();
    assert.equal(initial.settings.googleIntegration.enabled, true);
    assert.equal(initial.settings.googleIntegration.authMode, "publisher-hosted");
    assert.equal(initial.settings.googleIntegration.clientSecret, "");
    const config = initial.configPackages[0];
    const saved = await storage.saveConfigPackage({
      ...config, externalDeliveryMode: "integrated",
      studentLmsBinding: {
        ...config.studentLmsBinding, enabled: true, provider: "google-classroom",
        googleAuthMode: "publisher-hosted", clientId: initial.settings.googleIntegration.clientId,
        clientSecret: "must-not-be-exported", courseId: "course", assignmentId: "assignment"
      }
    });
    const binding = saved.configPackages.find((candidate) => candidate.id === config.id).studentLmsBinding;
    assert.equal(binding.googleAuthMode, "publisher-hosted");
    assert.equal(binding.clientSecret, undefined);
    assert.equal(binding.assignmentId, "assignment");
  });
});

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


test("saving a 42-question illustrated exam survives reopening and an inaccessible workspace", async () => {
  await withDataDirectory(async dir => {
    const storage = createStorageService(dir);
    const initial = await storage.getSnapshot();
    const exam = initial.exams.find(item => item.mode === "app");
    const question = exam.questions[0];
    const image = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cV3sAAAAASUVORK5CYII=" />';
    const questions = Array.from({ length: 42 }, (_, i) => ({ ...question, id: String(i + 1), prompt: image + " Question " + (i + 1) }));
    await storage.saveExam({ ...exam, id: "illustrated", questions });
    const file = join(dir, "lockedscreen-state.json");
    const original = await readFile(file);
    await rename(file, file + ".held");
    await mkdir(file);
    await assert.rejects(storage.saveExam({ ...exam, title: "Blocked write" }), /could not read your workspace/);
    await rmdir(file);
    await rename(file + ".held", file);
    assert.deepEqual(await readFile(file), original);
    assert.deepEqual((await createStorageService(dir).getSnapshot()).exams.find(item => item.id === "illustrated").questions, questions);
  });
});

test("hosted exam addresses save, update their inherited policy and reject unusable links without losing the previous exam", async () => {
  await withDataDirectory(async dir => {
    const storage = createStorageService(dir);
    const initial = await storage.getSnapshot();
    const base = { ...initial.exams[0], id: "hosted", mode: "link" };
    const save = url => storage.saveExam({ ...base, linkConfig: { url, allowedDomains: [] } });
    const first = await save("forms.example.edu/quiz");
    assert.equal(first.exams[0].linkConfig.url, "https://forms.example.edu/quiz");
    const second = await save("https://school.example.edu/updated");
    const policy = second.configPackages.find(item => item.examId === base.id).browserPolicy;
    assert.equal(policy.startUrl, "https://school.example.edu/updated");
    assert.equal(policy.urlRules[0].pattern, "https://school.example.edu");
    await assert.rejects(save("unfinished address"), /valid HTTPS exam URL/);
    assert.deepEqual((await createStorageService(dir).getSnapshot()).exams[0], second.exams[0]);
  });
});
