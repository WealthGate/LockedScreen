import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LOCKEDSCREEN_PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(join(tmpdir(), 'lockedscreen-hosted-ui-'));
const compiled = await build({ entryPoints: ['packages/storage/src/index.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, alias: { '@lockedscreen/exam-engine': './packages/exam-engine/src/index.ts' } });
const { createStorageService } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const fixture = await createStorageService(directory).getSnapshot();
const exam = fixture.exams.find(exam => exam.mode === 'app');
const root = resolve('apps/desktop/out/renderer');
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep)) throw new Error('outside fixture');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const version = JSON.parse(await readFile('apps/desktop/package.json', 'utf8')).version;
const out = resolve(`tmp/acceptance-${version}-hosted-ui`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.LOCKEDSCREEN_CHROME || undefined });
try {
  for (const width of [1360, 390]) {
    for (const scenario of ['normal', 'save-failure', 'expired', 'blocked', 'navigation-failure', 'delivery-failure', 'website-sign-in', 'provider-rejected', 'return-sign-in']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({ fixture, exam, scenario }) => {
        const state = structuredClone(fixture), callbacks = {}, events = [];
        const practice = state.exams.find(item => item.id === exam.id);
        Object.assign(practice, { mode: 'link', questions: [], durationMinutes: scenario === 'expired' ? 0.02 : 45,
          linkConfig: { url: 'https://docs.google.com/forms/d/e/fictional/viewform', allowedDomains: ['docs.google.com'] } });
        const config = state.configPackages.find(item => item.examId === exam.id);
        config.externalDeliveryMode = 'integrations';
        config.browserPolicy = { ...config.browserPolicy, startUrl: practice.linkConfig.url, allowedDomains: ['docs.google.com'],
          protectedBackToStart: true, showBackToStartButton: true };
        config.sessionPolicy = { ...config.sessionPolicy, restartInsteadOfQuit: true, timeoutAction: 'submit' };
        config.studentLmsBinding = { ...config.studentLmsBinding, enabled: true, provider: 'google-classroom',
          googleAuthMode: 'publisher-hosted', courseId: 'practice-course', assignmentId: 'practice-assignment' };
        state.installedRole = 'teacher';
        state.runtime = { platform: 'win32', nativeLockdown: { lockdownCapable: true }, canOnlyUseTestingMode: false };
        let saves = 0, deliveries = 0, navigations = 0, currentUrl = practice.linkConfig.url;
        window.confirm = () => { throw new Error('Exam must not use a native confirm dialog'); };
        HTMLElement.prototype.loadURL = async function(url) {
          if (this.tagName !== 'WEBVIEW') throw new Error('Not a webview');
          navigations++;
          if (scenario === 'navigation-failure' && navigations === 1) throw new Error('Simulated form navigation failure');
          currentUrl = url; events.push('navigate');
          if (scenario === 'return-sign-in') { callbacks.auth?.('signing-in'); await new Promise(resolve => setTimeout(resolve, 100)); }
        };
        HTMLElement.prototype.getURL = () => currentUrl;
        HTMLElement.prototype.setZoomFactor = value => { window.testExam.zoom = value; };
        const context = { installedRole: 'teacher', nativeHosted: false, packageImport: null,
          route: `/link/${exam.id}?candidateName=Practice%20Student&candidateId=practice` };
        const snapshot = () => structuredClone(state);
        window.testExam = { events, zoom: 1, blocked: () => callbacks.blocked?.(),
          authState: state => callbacks.auth?.(state),
          responsePage: () => { currentUrl = 'https://docs.google.com/forms/d/e/fictional/formResponse'; } };
        window.lockedscreenApi = new Proxy({
          getSnapshot: async () => snapshot(), getLaunchContext: async () => context, getUpdateState: async () => null,
          onHostedWebsiteAuthState: callback => { callbacks.auth = callback; callbacks.blocked = () => callback('blocked'); return () => {}; },
          beginSession: async request => { events.push('preauth', 'lock'); state.activeSession = { ...request, startedAt: new Date().toISOString() }; return snapshot(); },
          endSession: async (_reason, pin) => {
            if (pin !== '987654') throw new Error('Incorrect invigilator PIN. The exam remains locked.');
            events.push('release'); delete state.activeSession; return snapshot();
          },
          submitExam: async ({ session }) => {
            saves++; events.push('save-attempt');
            await new Promise(resolve => setTimeout(resolve, 100));
            if (['save-failure', 'expired'].includes(scenario) && saves === 1) throw new Error('Simulated disk save failure. Retry the session record.');
            const result = { id: 'practice-record', examId: exam.id, examTitle: exam.title, candidateName: 'Practice Student',
              candidateId: 'practice', score: 0, totalPoints: 0, percentage: 0, submittedAt: new Date().toISOString(), responses: [], syncStates: [],
              studentLmsTurnIn: { provider: 'google-classroom', status: 'pending' } };
            state.submissions.push(result); window.testExam.savedSession = session;
            return { result: structuredClone(result), snapshot: snapshot() };
          },
          turnInStudentLms: async () => {
            if (!state.activeSession) throw new Error('Turn-in must stay locked');
            deliveries++; events.push('delivery');
            if (scenario === 'delivery-failure' && deliveries === 1) throw new Error('Simulated Classroom delivery failure');
            const result = state.submissions.at(-1);
            result.studentLmsTurnIn = { provider: 'google-classroom', status: 'success', gradeSyncStatus: 'skipped',
              gradeSyncError: 'The form provider manages this exam grade.' };
            return { submission: structuredClone(result), state: result.studentLmsTurnIn, snapshot: snapshot() };
          }
        }, { get: (target, key) => target[key] ?? (String(key).startsWith('on') ? () => () => {} : async () => null) });
      }, { fixture, exam, scenario });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const unlock = page.getByRole('button', { name: 'Invigilator unlock', exact: true });
      await unlock.waitFor();
      const started = Date.now();
      const record = page.getByRole('button', { name: 'Record online submission', exact: true });
      const view = page.locator('webview');
      if (scenario === 'return-sign-in') {
        await page.getByRole('button', { name: 'Return to start', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Return to start', exact: true }).click();
        await page.getByText('Website sign-in in progress', { exact: true }).waitFor();
        await page.waitForTimeout(250);
        assert.equal(await record.isDisabled(), true, 'A resolved loadURL must not overwrite the redirected sign-in state');
        await page.evaluate(() => window.testExam.authState('exam'));
      }
      if (scenario === 'website-sign-in' || scenario === 'provider-rejected') {
        await page.evaluate(() => window.testExam.authState('signing-in'));
        await page.getByText('Website sign-in in progress', { exact: true }).waitFor();
        assert.equal(await view.isVisible(), true);
        assert.equal(await record.isDisabled(), true);
        assert.equal(await view.getAttribute('useragent'), null, 'No hard-coded Chrome masquerade');
        if (scenario === 'provider-rejected') {
          await page.evaluate(() => window.testExam.authState('provider-rejected'));
          await page.getByText('Google did not complete website sign-in', { exact: true }).waitFor();
          assert.equal(await record.isDisabled(), true);
          assert.equal(await view.isVisible(), true);
          await page.screenshot({ path: join(out, `provider-rejection-${width}.png`), fullPage: true });
        }
        await page.evaluate(() => window.testExam.authState('exam'));
        await page.waitForFunction(() => !document.body.innerText.includes('Website sign-in in progress'));
        assert.equal(await record.isDisabled(), false);
      }
      if (scenario === 'blocked') {
        await page.evaluate(() => window.testExam.blocked());
        await page.getByText('Navigation blocked by the exam policy', { exact: true }).waitFor();
        assert.equal(await record.isDisabled(), true);
        assert.match(await page.locator('body').innerText(), /Keep the teacher's response limit enabled/);
      } else if (scenario === 'expired') {
        await page.getByRole('heading', { name: 'Time expired', exact: true }).waitFor();
        await page.getByRole('alert').filter({ hasText: 'Simulated disk' }).waitFor();
        assert.equal(await view.isVisible(), false);
        await page.getByRole('button', { name: 'Save expired session record', exact: true }).click();
      } else {
        if (scenario === 'normal' || scenario === 'navigation-failure') {
          await page.getByRole('button', { name: 'Return to start', exact: true }).click();
          await page.getByRole('dialog').waitFor();
          assert.equal(await view.isVisible(), false);
          await page.getByRole('button', { name: 'Cancel', exact: true }).click();
          assert.equal(await view.isVisible(), true);
          await page.waitForTimeout(1200);
          await page.getByRole('button', { name: 'Restart form', exact: true }).click();
          await page.getByRole('dialog').getByRole('button', { name: 'Restart form', exact: true }).click();
          if (scenario === 'navigation-failure') {
            await page.getByRole('alert').filter({ hasText: 'Simulated form navigation failure' }).waitFor();
            await page.getByRole('button', { name: 'Return to start', exact: true }).click();
            await page.getByRole('dialog').getByRole('button', { name: 'Return to start', exact: true }).click();
          }
          await page.evaluate(() => window.testExam.responsePage());
          await page.getByText('Form response page reached', { exact: true }).waitFor();
          await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
          await page.waitForFunction(() => window.testExam.zoom > 1);
        }
        await record.click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        assert.equal(await view.isVisible(), false);
        assert.match(await dialog.innerText(), /local session record only/);
        if (scenario === 'normal') await page.screenshot({ path: join(out, `confirmation-${width}.png`), fullPage: true });
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal(await view.isVisible(), true);
        await record.click();
        await dialog.getByRole('button', { name: 'Save session record', exact: true }).dblclick();
        if (scenario === 'save-failure') {
          await page.getByRole('alert').filter({ hasText: 'Simulated disk' }).waitFor();
          await record.click();
          await dialog.getByRole('button', { name: 'Save session record', exact: true }).click();
        }
      }
      if (scenario !== 'blocked') {
        await page.getByRole('heading', { name: 'Session record saved', exact: true }).waitFor();
        await page.getByText('Record ID: practice-record', { exact: true }).waitFor();
        if (scenario === 'delivery-failure') {
          await page.getByRole('alert').filter({ hasText: 'Simulated Classroom delivery failure' }).waitFor();
          await page.getByRole('button', { name: 'Send result', exact: true }).click();
        }
        await page.getByText('Grade managed by the form provider', { exact: true }).waitFor();
        assert.equal(await view.isVisible(), false);
        assert.equal(await record.isDisabled(), true);
        const events = await page.evaluate(() => window.testExam.events);
        assert.equal(events.filter(event => event === 'save-attempt').length, ['save-failure', 'expired'].includes(scenario) ? 2 : 1);
        assert.equal(events.includes('release'), false);
        assert(new Date(await page.evaluate(() => window.testExam.savedSession.startedAt)).getTime() <= started + 100,
          'Return/restart must not reset the exam timer');
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: join(out, `${scenario}-${width}.png`), fullPage: true });
      await unlock.click();
      const pin = page.getByPlaceholder('Enter invigilator PIN');
      await pin.fill('wrong');
      const release = page.getByRole('button', { name: scenario === 'blocked' ? 'Unlock session' : 'Release student', exact: true });
      await release.click();
      await page.getByText(/Incorrect invigilator PIN\. The exam remains locked\./).first().waitFor();
      assert.equal((await page.evaluate(() => window.testExam.events)).includes('release'), false);
      await pin.fill('987654'); await release.click();
      await unlock.waitFor({ state: 'detached' });
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS ${width}px ${scenario}: hosted controls, visible feedback, no native dialog/browser, PIN-only release (mock IPC/webview).`);
    }
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
