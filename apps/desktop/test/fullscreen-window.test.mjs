import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createExamWindow } from './fixtures/exam-window.mjs';

const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
globalThis.fullscreenWindowTest = { display };
const result = await build({ entryPoints: ['apps/desktop/src/main/security/session-controller.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'fullscreen-electron', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, args => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
      export const BrowserWindow = { getAllWindows: () => [] };
      export const clipboard = { clear() {} };
      export const screen = { getDisplayMatching: () => globalThis.fullscreenWindowTest.display };
      export const session = { fromPartition: () => ({ clearStorageData: async () => {}, clearCache: async () => {} }) };
    ` }));
  } }] });
const controller = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const request = { examId: 'practice', packageId: 'practice-package', mode: 'app' };
const config = { label: 'Practice', securityMode: 'full-kiosk',
  sessionPolicy: { clearSessionOnStart: false, clearSessionOnEnd: false }, clipboardPolicy: { mode: 'allow' },
  browserPolicy: { allowedDomains: [], urlRules: [] } };
const audit = async () => {};

test('Windows fixed-size model reproduces a true fullscreen flag without display coverage', () => {
  const window = createExamWindow(display);
  window.setResizable(false);
  window.setKiosk(true);
  assert.equal(window.isFullScreen(), true);
  assert.equal(window.isKiosk(), true);
  assert.equal(window.getBounds().width, 900);
  assert.equal(controller.isExamWindowFullscreen(window), false);
});

test('fullscreen expands before pinning and release restores original geometry and constraints', async () => {
  for (const resizable of [true, false]) {
    const window = createExamWindow(display, { resizable });
    const original = { bounds: window.getBounds(), minimum: window.getMinimumSize(), maximum: window.getMaximumSize() };
    try {
      await controller.beginManagedSession(window, request, config, audit);
      assert.equal(controller.isExamWindowFullscreen(window), true);
      assert.deepEqual(window.getContentBounds(), display.bounds);
      assert.equal(window.isResizable(), false);
      assert.equal(window.isMaximizable(), false);
    } finally { await controller.endManagedSession(window, 'Practice exit', audit); }
    assert.equal(window.isFullScreen(), false);
    assert.equal(window.isResizable(), resizable);
    assert.deepEqual(window.getBounds(), original.bounds);
    assert.deepEqual(window.getMinimumSize(), original.minimum);
    assert.deepEqual(window.getMaximumSize(), original.maximum);
  }
});

test('recovery checks bounds even with fullscreen flags true and adapts to changed display metrics', async () => {
  const window = createExamWindow(display);
  const originalDisplay = { ...display.bounds };
  try {
    await controller.beginManagedSession(window, request, config, audit);
    window.state.bounds = { x: 0, y: 0, width: 900, height: 600 };
    assert.equal(window.isKiosk(), true);
    assert.equal(controller.reinforceExamWindow(window), true);
    assert.deepEqual(window.getBounds(), display.bounds);
    display.bounds = { x: -1280, y: 0, width: 1280, height: 720 };
    window.emit('resize');
    assert.deepEqual(window.getContentBounds(), display.bounds);
    assert.equal(controller.getActiveSession().securityHold, undefined);
  } finally {
    display.bounds = originalDisplay;
    await controller.endManagedSession(window, 'Practice exit', audit);
  }
});

test('failed window/content coverage refuses startup and restores normal controls', async () => {
  for (const failure of [{ refuseBounds: true }, { contentInset: 24 }]) {
    const window = createExamWindow(display, failure);
    const bounds = window.getBounds();
    await assert.rejects(controller.beginManagedSession(window, request, config, audit), /Fullscreen could not be confirmed/);
    assert.equal(controller.getActiveSession(), null);
    assert.equal(window.isFullScreen(), false);
    assert.equal(window.isResizable(), true);
    assert.deepEqual(window.getBounds(), bounds);
  }
});

test('unrecoverable geometry holds the current exam instead of silently unlocking it', async () => {
  const window = createExamWindow(display);
  try {
    await controller.beginManagedSession(window, request, config, audit);
    window.state.refuseBounds = true;
    window.state.bounds = { x: 0, y: 0, width: 900, height: 600 };
    window.emit('resize');
    assert.match(controller.getActiveSession().securityHold, /Fullscreen protection/);
    assert.equal(window.state.messages.at(-1).channel, 'session:securityHold');
    assert.equal(controller.getActivePackage(), config);
  } finally { await controller.endManagedSession(window, 'Invigilator release', audit); }
});
