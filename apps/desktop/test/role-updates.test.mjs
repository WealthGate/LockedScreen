import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

test('role updates keep their channel and defer installation during exams', async () => {
  for (const role of ['student', 'teacher', 'selectable']) {
    const handlers = new Map();
    const appEvents = new Map();
    const updater = { on() {}, quitAndInstall() { assert.fail('Installation must be held'); } };
    globalThis.roleUpdateTest = { handlers, appEvents, updater };
    try {
      const result = await build({
        entryPoints: ['apps/desktop/src/main/update-service.ts'],
        bundle: true, platform: 'node', format: 'esm', write: false,
        define: { __LOCKEDSCREEN_EDITION__: JSON.stringify(role) },
        plugins: [{ name: 'mock-updates', setup(builder) {
          builder.onResolve({ filter: /^(electron|electron-updater)$/ }, args => ({ path: args.path, namespace: 'mock' }));
          builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'electron'
            ? `export const app = { getVersion: () => '0.6.57', isPackaged: true, getPath: () => '.', on: (name, handler) => globalThis.roleUpdateTest.appEvents.set(name, handler) }; export const BrowserWindow = {}; export const Notification = {}; export const ipcMain = { handle: (name, handler) => globalThis.roleUpdateTest.handlers.set(name, handler) }; export const shell = {};`
            : `export default { autoUpdater: globalThis.roleUpdateTest.updater };`
          }));
        }}]
      });
      const module = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
      let inExam = true;
      module.configureAppUpdates(() => null, { canInstall: () => !inExam });
      const fixed = role !== 'selectable';
      assert.equal(updater.channel, fixed ? role : undefined);
      assert.equal(updater.autoDownload, fixed);
      assert.equal(updater.allowPrerelease, false);
      appEvents.get('before-quit')();
      assert.equal(updater.autoInstallOnAppQuit, false);
      assert.match((await handlers.get('updates:install')()).message, /Finish the exam/);
      inExam = false;
      appEvents.get('before-quit')();
      assert.equal(updater.autoInstallOnAppQuit, fixed);
    } finally {
      delete globalThis.roleUpdateTest;
    }
  }
});
