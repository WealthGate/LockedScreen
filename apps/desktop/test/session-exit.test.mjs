import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

test('managed exit releases window and session despite cleanup or audit failures', async (t) => {
  const state = { clearStorageData: async () => {}, clearCache: async () => {} };
  globalThis.sessionExitTest = state;
  const result = await build({
    entryPoints: ['apps/desktop/src/main/security/session-controller.ts'],
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'mock-electron', setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, args => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
        export const BrowserWindow = { getAllWindows: () => [] };
        export const clipboard = { clear() {} };
        export const session = { fromPartition: () => globalThis.sessionExitTest };
      ` }));
    } }]
  });
  const controller = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  const config = {
    label: 'Fictional test exam', securityMode: 'test',
    sessionPolicy: { clearSessionOnStart: false, clearSessionOnEnd: true },
    clipboardPolicy: { mode: 'allow' }
  };
  const windowState = {};
  const window = {
    setAlwaysOnTop: value => { windowState.top = value; },
    setFullScreen: value => { windowState.fullscreen = value; }
  };
  const audit = async () => {};
  t.mock.method(console, 'warn', () => {});
  try {
    for (const scenario of ['normal', 'storage rejects', 'cache rejects', 'cleanup stalls', 'audit rejects', 'audit stalls']) {
      await t.test(scenario, async () => {
        const failure = async () => { throw new Error('simulated failure'); };
        let finishCleanup;
        state.clearStorageData = scenario === 'storage rejects' ? failure
          : scenario === 'cleanup stalls' ? () => new Promise(resolve => { finishCleanup = resolve; }) : async () => {};
        state.clearCache = scenario === 'cache rejects' ? failure : async () => {};
        await controller.beginManagedSession(window, { examId: 'test', packageId: 'test', mode: 'link' }, config, audit);
        controller.setNavigationGuard({ mode: 'link', allowedDomains: ['example.org'] });
        assert.equal(windowState.fullscreen, true);
        const exitAudit = scenario === 'audit rejects' ? failure
          : scenario === 'audit stalls' ? () => new Promise(() => {}) : audit;
        const ending = controller.endManagedSession(window, 'Test invigilator exit', exitAudit);
        assert.equal(windowState.fullscreen, false);
        assert.equal(windowState.top, false);
        assert.equal(controller.getActiveSession(), null);
        assert.equal(controller.getActivePackage(), null);
        assert.equal(controller.urlAllowedByGuard('https://example.org'), false);
        await ending;
        if (finishCleanup) {
          await assert.rejects(
            controller.beginManagedSession(window, { examId: 'next', packageId: 'test', mode: 'link' }, config, audit),
            /cleanup is still running/
          );
          finishCleanup();
          await new Promise(resolve => setImmediate(resolve));
        }
      });
    }
  } finally {
    delete globalThis.sessionExitTest;
  }
});
