import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { makePdf } from './fixtures/practice-pdf.mjs';

const require = createRequire(import.meta.url);
const { _electron } = require(process.env.LOCKEDSCREEN_PLAYWRIGHT_MODULE || 'playwright');
const version = JSON.parse(await readFile('apps/desktop/package.json', 'utf8')).version;
const archive = resolve(process.argv[2] || `apps/desktop/dist-store/${version}/win-unpacked/resources/app.asar`);
const root = resolve('tmp'); await mkdir(root, { recursive: true });
const directory = await mkdtemp(join(root, 'acceptance-electron-'));
const canvas = createCanvas(1200, 480), ctx = canvas.getContext('2d');
ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1200, 480); ctx.fillStyle = 'black'; ctx.font = 'bold 42px Arial';
ctx.fillText('PRACTICE SCIENCE EXAM', 50, 100); ctx.fillText('THE SYMBOL FOR SODIUM IS Na', 50, 180);
const typed = join(directory, 'typed.pdf'), scanned = join(directory, 'scanned.pdf');
await writeFile(typed, makePdf()); await writeFile(scanned, makePdf(canvas.toBuffer('image/jpeg')));
const application = await _electron.launch({ executablePath: require('electron'), args: ['--use-fake-device-for-media-stream', resolve('apps/desktop/test/electron-smoke-harness.cjs')],
  cwd: process.cwd(), env: { ...process.env, LOCKEDSCREEN_SMOKE_PROFILE: join(directory, 'profile'), LOCKEDSCREEN_SMOKE_ARCHIVE: archive }, timeout: 60000 });
try {
  const window = await application.firstWindow();
  const errors = []; window.on('pageerror', error => errors.push(error.message));
  await window.waitForFunction(() => Boolean(window.lockedscreenApi), { timeout: 30000 });
  const snapshot = await window.evaluate(() => window.lockedscreenApi.getSnapshot());
  assert(Array.isArray(snapshot.exams));
  const versions = await application.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node }));
  assert.equal(versions.electron, '45.3.4');
  if (snapshot.installedRole === 'student') {
    assert.match(await window.evaluate(() => window.lockedscreenApi.saveExam({}).then(() => 'unexpected success', error => error.message)), /Teacher edition/);
  } else {
    await window.evaluate(async () => {
      const capture = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        try { return stream.getAudioTracks().length; }
        finally { stream.getTracks().forEach(track => track.stop()); }
      };
      const initial = await capture().then(() => 'granted', error => error.name);
      if (initial !== 'NotAllowedError') throw new Error('Unexpected unarmed teacher microphone result: ' + initial);
      await window.lockedscreenApi.preparePromptMic();
      if (await capture() !== 1) throw new Error('Expected exactly one synthetic audio track');
    });
    console.log('PASS: archived teacher window denies unarmed microphone and allows explicitly requested audio.');
    for (const [file, expected] of [[typed, 'pdf-text'], [scanned, 'pdf-ocr']]) {
      await application.evaluate((_electron, path) => { globalThis.lockedscreenSmokeImportFile = path; }, file);
      const preview = await window.evaluate(() => window.lockedscreenApi.importQuestions());
      assert.equal(preview.extraction.method, expected);
      assert.match(preview.sourceText, /sodium/i);
    }
  }
  await application.evaluate(async ({ BrowserWindow }) => {
    const foreign = new BrowserWindow({ show: false, webPreferences: { preload: globalThis.lockedscreenSmokePaths.preload, contextIsolation: true, sandbox: true, nodeIntegration: false } });
    await foreign.loadURL('data:text/html,<h1>Foreign test frame</h1>');
    const message = await foreign.webContents.executeJavaScript('window.lockedscreenApi.getSnapshot().then(() => "unexpected success", error => error.message)');
    foreign.destroy();
    if (!message.includes('trusted LockedScreen application window')) throw new Error('Foreign frame was not rejected: ' + message);
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ role: snapshot.installedRole, versions, startup: 'pass', trustedIpc: 'pass', archivedPdfImports: snapshot.installedRole === 'student' ? 'not included' : 'typed + scanned pass', physicalLockdown: 'disabled in harness' }));
} finally {
  await application.close();
  if (!directory.startsWith(root + sep)) throw new Error('Unsafe test cleanup');
  await rm(directory, { recursive: true, force: true });
}
