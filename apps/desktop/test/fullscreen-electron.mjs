import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'lockedscreen-window-'));
try {
  await build({ entryPoints: ['apps/desktop/src/main/security/session-controller.ts'], bundle: true,
    platform: 'node', format: 'cjs', external: ['electron'], outfile: join(directory, 'controller.cjs') });
  const fixture = String.raw`
    const assert = require('node:assert/strict');
    const { app, BrowserWindow, screen } = require('electron');
    const controller = require('./controller.cjs');
    app.on('window-all-closed', () => {});
    app.whenReady().then(async () => {
      let window;
      try {
        window = new BrowserWindow({ width: 900, height: 600, show: false, webPreferences: { sandbox: true } });
        // Window-only fixture: no native agent, input hooks, real exam, credentials or clipboard access.
        window.focus = () => {};
        window.setContentProtection = () => {};
        await window.loadURL('data:text/html,<body style="margin:0;background:%230c6258;color:white;font:24px sans-serif"><h1>Fullscreen geometry test</h1><p>Synthetic window fixture. No exam or native lockdown.</p></body>');
        const original = window.getBounds();
        if (process.env.LOCKEDSCREEN_WINDOW_TRACE) {
          console.log('initial', screen.getPrimaryDisplay(), original);
          window.on('resize', () => console.log('resize', window.getBounds(), window.getContentBounds(), screen.getDisplayMatching(window.getBounds()).bounds));
        }
        const request = { examId: 'synthetic', packageId: 'synthetic', mode: 'app' };
        const config = { label: 'Synthetic', securityMode: 'full-kiosk',
          sessionPolicy: { clearSessionOnStart: false, clearSessionOnEnd: false },
          clipboardPolicy: { mode: 'allow' }, browserPolicy: { allowedDomains: [], urlRules: [] } };
        const metrics = screen.getDisplayMatching(original);
        const inconsistentMetrics = metrics.workArea.width > metrics.bounds.width + 1 || metrics.workArea.height > metrics.bounds.height + 1;
        if (inconsistentMetrics) {
          await assert.rejects(controller.beginManagedSession(window, request, config, async () => {}), /Fullscreen could not be confirmed/);
          assert.equal(controller.getActiveSession(), null);
          assert.equal(window.isFullScreen(), false);
          console.log(JSON.stringify({ scale: metrics.scaleFactor, refusedInconsistentForcedMetrics: true, display: metrics.bounds, workArea: metrics.workArea }));
          window.destroy();
          app.exit(0);
          return;
        }
        await controller.beginManagedSession(window, request, config, async () => {});
        await new Promise(resolve => setTimeout(resolve, 250));
        assert.equal(controller.isExamWindowFullscreen(window), true);
        const display = screen.getDisplayMatching(window.getBounds());
        const result = { scale: display.scaleFactor, display: display.bounds, window: window.getBounds(), content: window.getContentBounds() };
        const image = await window.webContents.capturePage();
        assert.ok(!image.isEmpty());
        const bitmap = image.toBitmap();
        assert.ok(bitmap.some((value, index) => index % 4 !== 3 && value !== 0), 'fixture pixels must be nonblank');
        require('node:fs').writeFileSync(process.env.LOCKEDSCREEN_WINDOW_SCREENSHOT, image.toPNG());
        if (process.env.LOCKEDSCREEN_WINDOW_TRACE) {
          for (const name of ['setResizable', 'setMinimumSize', 'setMaximumSize', 'setKiosk', 'setFullScreen', 'setBounds', 'setMaximizable', 'setMovable']) {
            const originalMethod = window[name].bind(window);
            window[name] = (...args) => { const result = originalMethod(...args); console.log(name, args, window.getBounds(), window.getMinimumSize(), window.getMaximumSize(), { fullscreen: window.isFullScreen(), maximized: window.isMaximized(), movable: window.isMovable(), resizable: window.isResizable() }); return result; };
          }
        }
        await controller.endManagedSession(window, 'Synthetic fixture cleanup', async () => {});
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.equal(window.isKiosk(), false);
        assert.equal(window.isFullScreen(), false);
        assert.deepEqual(window.getBounds(), original);
        console.log(JSON.stringify({ ...result, restored: window.getBounds(), nonblank: true }));
        window.destroy();
        app.exit(0);
      } catch (error) {
        console.error(error);
        if (window && !window.isDestroyed()) console.error(JSON.stringify({ display: screen.getDisplayMatching(window.getBounds()), bounds: window.getBounds(), content: window.getContentBounds(), fullscreen: window.isFullScreen() }));
        try { await controller.endManagedSession(window, 'Fixture failure cleanup', async () => {}); } catch {}
        if (window && !window.isDestroyed()) window.destroy();
        app.exit(1);
      }
    });
  `;
  await writeFile(join(directory, 'fixture.cjs'), fixture);
  const { mkdir } = await import('node:fs/promises');
  const version = JSON.parse(await readFile('apps/desktop/package.json', 'utf8')).version;
  const screenshots = resolve(`tmp/acceptance-fullscreen-${version}`);
  await mkdir(screenshots, { recursive: true });
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  for (const scale of [1, 1.25, 1.5]) {
    const result = spawnSync(require('electron'), [
      `--force-device-scale-factor=${scale}`, `--user-data-dir=${join(directory, `profile-${scale}`)}`,
      join(directory, 'fixture.cjs')
    ], { encoding: 'utf8', timeout: 20000, env: { ...environment,
      LOCKEDSCREEN_WINDOW_SCREENSHOT: join(screenshots, `scale-${scale}.png`) } });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    console.log(`PASS: Electron window-only ${scale * 100}%: ${result.stdout.trim()}`);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
