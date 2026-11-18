import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LOCKEDSCREEN_PLAYWRIGHT_MODULE || 'playwright');
const fixtureDirectory = await mkdtemp(join(tmpdir(), 'lockedscreen-ui-'));
const compiled = await build({ entryPoints: ['packages/storage/src/index.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, alias: { '@lockedscreen/exam-engine': './packages/exam-engine/src/index.ts' } });
const { createStorageService } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const fixture = await createStorageService(fixtureDirectory).getSnapshot();
const exam = fixture.exams.find(exam => exam.mode === 'app');
const root = resolve('apps/desktop/out/renderer');
const server = createServer(async (req, res) => {
  try {
    const file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + sep)) throw new Error('outside test root');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const out = resolve('tmp/acceptance-0.6.62-ui');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.LOCKEDSCREEN_CHROME || undefined });
try {
  for (const width of [1360, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ fixture, exam }) => {
      let state = structuredClone(fixture);
      state.installedRole = 'teacher';
      state.runtime = { platform: 'win32', nativeLockdown: { lockdownCapable: true }, canOnlyUseTestingMode: false };
      const callbacks = {};
      const context = { installedRole: 'teacher', nativeHosted: false, packageImport: null,
        route: `/session/${exam.id}?candidateName=Practice%20Student&candidateId=test-candidate` };
      const snapshot = () => structuredClone(state);
      window.testExam = {
        switchView(route) { callbacks.launch?.({ ...context, route }); },
        pause() { state.activeSession.securityHold = 'Simulated protection failure'; callbacks.hold?.(); }
      };
      window.lockedscreenApi = new Proxy({
        getSnapshot: async () => snapshot(), getLaunchContext: async () => context, getUpdateState: async () => null,
        onLaunchContextChanged: callback => { callbacks.launch = callback; return () => {}; },
        onSessionSecurityHold: callback => { callbacks.hold = callback; return () => {}; },
        beginSession: async request => {
          await new Promise(resolve => setTimeout(resolve, 150));
          state.activeSession ??= { ...request, startedAt: new Date().toISOString() };
          return snapshot();
        },
        endSession: async (_reason, pin) => {
          if (pin !== '987654') throw new Error('Incorrect invigilator PIN. The exam remains locked.');
          delete state.activeSession;
          return snapshot();
        }
      }, { get: (target, key) => target[key] ?? (String(key).startsWith('on') ? () => () => {} : async () => null) });
    }, { fixture, exam });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const unlock = page.getByRole('button', { name: 'Invigilator unlock', exact: true });
    await unlock.waitFor();
    await page.getByText('What is the chemical symbol for sodium?', { exact: true }).waitFor();
    await page.getByText('Na', { exact: true }).click();
    await page.evaluate(() => window.testExam.switchView('/teacher'));
    await page.waitForTimeout(250);
    assert.equal(await unlock.count(), 1, 'Teacher launch must not replace the active exam');
    assert.equal(await page.getByRole('button', { name: 'Create Exam', exact: true }).count(), 0);
    await page.evaluate(() => window.testExam.switchView('/student'));
    await page.waitForTimeout(250);
    assert.equal(await unlock.count(), 1, 'Student portal launch must not replace the active exam');
    await unlock.click();
    const pin = page.getByPlaceholder('Enter invigilator PIN');
    await pin.fill('wrong');
    await page.getByRole('button', { name: 'Unlock session', exact: true }).click();
    await page.getByText(/Incorrect invigilator PIN\. The exam remains locked\./).waitFor();
    assert.equal(await pin.getAttribute('type'), 'password');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => window.testExam.pause());
    await page.getByRole('heading', { name: 'Exam paused' }).waitFor();
    assert.equal(await page.getByText('What is the chemical symbol for sodium?', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(out, `locked-hold-${width}.png`), fullPage: true });
    await unlock.click();
    await pin.fill('987654');
    await page.getByRole('button', { name: 'Unlock session', exact: true }).click();
    await unlock.waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS: ${width}px active routing, wrong PIN, masked PIN, protection hold and correct release (mock IPC; no OS hooks).`);
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(fixtureDirectory, { recursive: true, force: true });
}
