import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

test('Store update actions never invoke the GitHub installer', async () => {
  const handlers = new Map();
  const opened = [];
  globalThis.storeUpdateTest = { handlers, opened };
  const previous = process.windowsStore;
  process.windowsStore = true;
  try {
    const result = await build({
      entryPoints: ['apps/desktop/src/main/update-service.ts'],
      bundle: true, platform: 'node', format: 'esm', write: false,
      plugins: [{ name: 'mock-electron', setup(builder) {
        builder.onResolve({ filter: /^(electron|electron-updater)$/ }, args => ({ path: args.path, namespace: 'mock' }));
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'electron'
          ? `export const app = { getVersion: () => '0.6.54', isPackaged: true }; export const BrowserWindow = {}; export const Notification = {}; export const ipcMain = { handle: (name, handler) => globalThis.storeUpdateTest.handlers.set(name, handler) }; export const shell = { openExternal: async url => globalThis.storeUpdateTest.opened.push(url) };`
          : `export default { autoUpdater: new Proxy({}, { get() { throw new Error('GitHub updater accessed'); }, set() { throw new Error('GitHub updater configured'); } }) };`
        }));
      }}]
    });
    const module = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
    module.configureAppUpdates(() => null);
    module.checkForAppUpdatesAfterStartup();
    assert.equal((await handlers.get('updates:getState')()).channel, 'microsoft-store');
    for (const action of ['check', 'download', 'install']) await handlers.get(`updates:${action}`)();
    assert.deepEqual(opened, Array(3).fill('ms-windows-store://pdp/?productid=9NRCCBKRLXBJ'));
  } finally {
    if (previous === undefined) delete process.windowsStore; else process.windowsStore = previous;
    delete globalThis.storeUpdateTest;
  }
});
