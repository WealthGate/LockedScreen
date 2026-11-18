import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const load = async entry => {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
};

test('active exams deny all non-exam capabilities, independent of installation role', async () => {
  const { assertSessionOperation } = await load('apps/desktop/src/main/security/session-policy.ts');
  const denied = ['settings:save', 'security:save', 'exam:save', 'exam:delete', 'configPackage:import',
    'window:setAssistKiosk', 'window:setNavigationGuard', 'shell:openExternal', 'applications:launch',
    'help:openGoogleAppsScript', 'classroom:openSetupGuide', 'lmsConnection:connect',
    'updates:check', 'updates:download', 'updates:install', 'future:unknown'];
  for (const channel of denied) {
    assert.throws(() => assertSessionOperation(true, channel), /exam is locked/);
    assert.doesNotThrow(() => assertSessionOperation(false, channel));
  }
  for (const channel of ['app:getSnapshot', 'app:getLaunchContext', 'session:begin', 'session:end', 'exam:submit', 'studentLms:turnIn']) {
    assert.doesNotThrow(() => assertSessionOperation(true, channel));
  }
});

test('package PIN takes precedence over teacher settings and no exit setting bypasses it', async () => {
  const { assertSessionExitPin, isSameSession } = await load('apps/desktop/src/main/security/session-policy.ts');
  const { createPinVerifier } = await load('apps/desktop/src/main/security/invigilator-pin.ts');
  const config = { quitUnlockPolicy: { requireInvigilatorPin: false, pinVerifier: createPinVerifier('789012') },
    sessionPolicy: { allowExitAfterSubmit: true } };
  for (const pin of [undefined, null, '', 'wrong', '2468', 'x'.repeat(129)]) {
    assert.throws(() => assertSessionExitPin(config, pin, '2468'), /remains locked/);
  }
  assert.doesNotThrow(() => assertSessionExitPin(config, '789012', '2468'));
  const local = { quitUnlockPolicy: {} };
  assert.doesNotThrow(() => assertSessionExitPin(local, '2468', '2468'));
  assert.throws(() => assertSessionExitPin(local, '', ''), /remains locked/);
  const current = { examId: 'exam', packageId: 'package', mode: 'app' };
  assert.equal(isSameSession(current, { ...current }), true);
  for (const change of [{ examId: 'other' }, { packageId: 'other' }, { mode: 'link' }]) {
    assert.equal(isSameSession(current, { ...current, ...change }), false);
  }
});

test('exam startup waits for earlier asynchronous browser, dialog and turn-in operations', async () => {
  const { createSessionStartBarrier } = await load('apps/desktop/src/main/security/session-policy.ts');
  const barrier = createSessionStartBarrier();
  for (const channel of ['lmsConnection:connect', 'configPackage:import', 'window:captureScreenshot', 'studentLms:turnIn', 'future:unknown']) {
    let finish;
    const operation = barrier.run(channel, () => new Promise(resolve => { finish = resolve; }));
    assert.throws(() => barrier.assertIdle(), /operation to finish/);
    finish('done');
    assert.equal(await operation, 'done');
    assert.doesNotThrow(() => barrier.assertIdle());
  }
  for (const channel of ['app:getSnapshot', 'updates:getState', 'session:begin', 'session:end', 'session:launchAlternateDesktop']) {
    await barrier.run(channel, () => barrier.assertIdle());
  }
  await assert.rejects(barrier.run('lmsConnection:connect', () => { throw new Error('Canceled sign-in'); }), /Canceled/);
  assert.doesNotThrow(() => barrier.assertIdle());
  let finishFirst, finishSecond;
  const first = barrier.run('results:exportCsv', () => new Promise(resolve => { finishFirst = resolve; }));
  const second = barrier.run('import:questions', () => new Promise(resolve => { finishSecond = resolve; }));
  finishFirst(); await first;
  assert.throws(() => barrier.assertIdle(), /operation to finish/);
  finishSecond(); await second;
  assert.doesNotThrow(() => barrier.assertIdle());
});

test('main IPC and renderer enforce the policy, not just the exit dialog', async () => {
  const main = await readFile('apps/desktop/src/main/index.ts', 'utf8');
  assert.match(main, /event\.sender !== mainWindow\.webContents/);
  assert.match(main, /event\.senderFrame !== mainWindow\.webContents\.mainFrame/);
  assert.match(main, /assertSessionOperation\(Boolean\(getActiveSession\(\)\)/);
  assert.match(main, /configureAppUpdates\([\s\S]*?registerIpc: handleIpc/);
  assert.match(main, /sessionStartBarrier\.run\(channel, \(\) => listener\(\.\.\.args\)\)/);
  const exit = main.slice(main.indexOf('handleIpc("session:end"'), main.indexOf('handleIpc("applications:launch"'));
  assert(exit.indexOf('assertSessionExitPin(') < exit.indexOf('await endManagedSession('));
  assert.doesNotMatch(exit, /installedRole === "student"/);
  const begin = main.slice(main.indexOf('handleIpc("session:begin"'), main.indexOf('handleIpc("session:launchAlternateDesktop"'));
  assert.doesNotMatch(begin, /nativeCompanionRequired/);
  assert.match(begin, /verifyHostedNativeSession/);
  assert.match(begin, /getAllDisplays\(\)\.length !== 1/);
  assert(begin.indexOf('sessionStartBarrier.assertIdle()') < begin.indexOf('sessionStarting = true'));
  const alternate = main.slice(main.indexOf('handleIpc("session:launchAlternateDesktop"'), main.indexOf('handleIpc("session:end"'));
  assert(alternate.indexOf('sessionStarting = true') < alternate.indexOf('await storage.getSnapshot()'), 'double launches must be serialized before the first await');
  assert(alternate.indexOf('sessionStartBarrier.assertIdle()') < alternate.indexOf('sessionStarting = true'));
  assert(exit.indexOf('sessionStarting = true') < exit.indexOf('await storage.getSnapshot()'), 'new starts must not race an authorized release');
  const ui = await readFile('apps/desktop/src/renderer/App.tsx', 'utf8');
  assert.equal((ui.match(/<Routes location=\{examRoute \?\? location\}>/g) ?? []).length, 2);
  assert.doesNotMatch(ui, /endCurrentSession\("Closed .* exam runtime"/);
  assert.doesNotMatch(ui, /lockedscreenApi\.setNavigationGuard/);
  assert.match(ui, /ExamStartupStatus/);
});

test('renderer release requires an unlocked snapshot, not just a resolved failed operation', async () => {
  const { waitForSessionRelease } = await load('apps/desktop/src/renderer/lib/session-release.ts');
  assert.equal(await waitForSessionRelease(Promise.resolve(null)), false);
  assert.equal(await waitForSessionRelease(Promise.resolve({ activeSession: { examId: 'exam' } })), false);
  assert.equal(await waitForSessionRelease(Promise.resolve({ exams: [] })), true);
  await assert.rejects(waitForSessionRelease(Promise.reject(new Error('Incorrect PIN'))), /Incorrect PIN/);
  assert.equal(await waitForSessionRelease(new Promise(() => {}), 10), false);
});

test('invalid or unrecoverable PIN configurations refuse exam startup', async () => {
  const { assertSessionPinConfigured } = await load('apps/desktop/src/main/security/session-policy.ts');
  const { createPinVerifier } = await load('apps/desktop/src/main/security/invigilator-pin.ts');
  const local = { quitUnlockPolicy: {} };
  assert.doesNotThrow(() => assertSessionPinConfigured(local, '654321', true));
  for (const pin of ['', ' '.repeat(6), 'x'.repeat(129)]) assert.throws(() => assertSessionPinConfigured(local, pin, true), /valid invigilator PIN/);
  assert.throws(() => assertSessionPinConfigured(local, '654321', false), /re-export/);
  for (const verifier of [{}, { salt: 'bad', digest: 'bad' }]) {
    assert.throws(() => assertSessionPinConfigured({ quitUnlockPolicy: { pinVerifier: verifier } }, '654321', true), /valid invigilator PIN/);
  }
  assert.doesNotThrow(() => assertSessionPinConfigured({ quitUnlockPolicy: { pinVerifier: createPinVerifier('654321') } }, '', false));
  assert.throws(() => createPinVerifier('x'.repeat(129)), /at most 128/);
});

test('production launches reject remote debugging and sandbox-disabling flags', async () => {
  const { unsafeProductionSwitch } = await load('apps/desktop/src/main/security/session-policy.ts');
  for (const flag of ['remote-debugging-port', 'remote-debugging-pipe', 'no-sandbox', 'disable-gpu-sandbox', 'disable-web-security']) {
    assert.equal(unsafeProductionSwitch(name => name === flag), flag);
  }
  assert.equal(unsafeProductionSwitch(name => name === 'user-data-dir' || name === 'lockedscreen-native-hosted'), undefined);
});
