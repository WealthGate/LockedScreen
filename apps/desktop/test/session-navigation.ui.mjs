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
const version = JSON.parse(await readFile('apps/desktop/package.json', 'utf8')).version;
const out = resolve(`tmp/acceptance-${version}-ui`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.LOCKEDSCREEN_CHROME || undefined,
  args: ['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
try {
  for (const width of [1360, 390]) {
   for (const scenario of ['teacher-prompt', 'hold', 'lms', 'cancel', 'language']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ fixture, exam, scenario }) => {
      let state = structuredClone(fixture);
      state.installedRole = 'teacher';
      state.runtime = { platform: 'win32', nativeLockdown: { lockdownCapable: true }, canOnlyUseTestingMode: false };
      const callbacks = {};
      const context = { installedRole: 'teacher', nativeHosted: false, packageImport: null,
        route: scenario === 'teacher-prompt' ? `/teacher/builder/${exam.id}` : `/session/${exam.id}?candidateName=Practice%20Student&candidateId=test-candidate` };
      const snapshot = () => structuredClone(state);
      const events = [];
      let turnInAttempts = 0;
      if (scenario !== 'hold') {
        const practice = state.exams.find(item => item.id === exam.id);
        practice.questions = [practice.questions[0]];
        if (scenario === 'language') {
          practice.durationMinutes = 0.13;
          practice.questions[0].spokenAnswer = true;
          practice.questions[0].listening = { plays: 1, speed: 0.75,
            src: 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQIAAAAAAA==' };
        }
        const config = state.configPackages.find(item => item.examId === exam.id);
        config.externalDeliveryMode = 'integrations';
        config.studentLmsBinding = { ...config.studentLmsBinding, enabled: true, provider: 'google-classroom',
          googleAuthMode: 'publisher-hosted', courseId: 'practice-course', assignmentId: 'practice-assignment' };
      }
      window.testExam = {
        events,
        switchView(route) { callbacks.launch?.({ ...context, route }); },
        pause() { state.activeSession.securityHold = 'Simulated protection failure'; callbacks.hold?.(); }
      };
      window.lockedscreenApi = new Proxy({
        preparePromptMic: async () => {events.push('teacher-mic');},
        saveExam: async exam => {window.testExam.savedExam = exam; return snapshot();},
        getSnapshot: async () => snapshot(), getLaunchContext: async () => context, getUpdateState: async () => null,
        onLaunchContextChanged: callback => { callbacks.launch = callback; return () => {}; },
        onSessionSecurityHold: callback => { callbacks.hold = callback; return () => {}; },
        beginSession: async request => {
          if (scenario !== 'hold') events.push('google-sign-in');
          if (scenario === 'cancel') throw new Error('Student sign-in cancelled. The exam has not started.');
          await new Promise(resolve => setTimeout(resolve, 150));
          if (scenario !== 'hold') events.push('lock');
          state.activeSession ??= { ...request, startedAt: new Date().toISOString() };
          return snapshot();
        },
        endSession: async (_reason, pin) => {
          if (pin !== '987654') throw new Error('Incorrect invigilator PIN. The exam remains locked.');
          events.push('end-session');
          delete state.activeSession;
          return snapshot();
        },
        submitExam: async ({ exam, session }) => {
          window.testExam.savedAudio = Object.values(session.spokenAnswers ?? {})[0];
          events.push('submit');
          const result = { id: 'practice-submission', examId: exam.id, examTitle: exam.title,
            candidateName: 'Practice Student', candidateId: 'test-candidate', score: 1, totalPoints: 1, percentage: 100,
            submittedAt: new Date().toISOString(), responses: session.responses, syncStates: [],
            studentLmsTurnIn: { provider: 'google-classroom', status: 'pending' } };
          state.submissions.push(result);
          return { result: structuredClone(result), snapshot: snapshot() };
        },
        turnInStudentLms: async ({ submissionId }) => {
          if (!state.activeSession) throw new Error('Practice exam must remain locked during turn-in');
          events.push('turn-in');
          turnInAttempts++;
          const result = state.submissions.find(item => item.id === submissionId);
          result.studentLmsTurnIn = { provider: 'google-classroom', status: 'success',
            gradeSyncStatus: turnInAttempts === 1 ? 'failed' : 'success',
            gradeSyncError: turnInAttempts === 1 ? 'Simulated temporary grade failure' : undefined,
            gradeValue: turnInAttempts === 1 ? undefined : 100 };
          return { state: structuredClone(result.studentLmsTurnIn), submission: structuredClone(result), snapshot: snapshot() };
        }
      }, { get: (target, key) => target[key] ?? (String(key).startsWith('on') ? () => () => {} : async () => null) });
    }, { fixture, exam, scenario });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    if (scenario === 'teacher-prompt') {
      const group = page.getByRole('group',{name:'Language audio'}).first();
      await group.locator('input[type=file]').setInputFiles({name:'original.wav',mimeType:'audio/wav',buffer:Buffer.from('test')});
      await group.getByLabel('Plays per attempt').selectOption('3');
      await group.getByLabel('Playback speed').selectOption('0.75');
      const original = await group.getByLabel('Preview listening clip').getAttribute('src');
      const take = async () => {
        await group.getByRole('button',{name:'Record prompt',exact:true}).click();
        await group.getByRole('button',{name:'Stop recording'}).waitFor();
        await page.waitForTimeout(350);
        await group.getByRole('button',{name:'Stop recording'}).click();
        await group.getByLabel('Preview recorded prompt').waitFor();
        assert(await page.getByRole('button',{name:'Save exam',exact:true}).isDisabled());
      };
      await take();
      await group.getByRole('button',{name:'Discard recording'}).click();
      assert.equal(await group.getByLabel('Preview listening clip').getAttribute('src'), original);
      await take();
      await group.getByRole('button',{name:'Use recording'}).click();
      await page.getByRole('button',{name:'Save exam',exact:true}).click();
      const saved=await page.evaluate(()=>window.testExam.savedExam.questions[0].listening);
      assert.match(saved.src,/^data:audio\/webm;base64,.{100}/);
      assert.equal(saved.plays,3); assert.equal(saved.speed,0.75);
      assert.deepEqual(await page.evaluate(()=>window.testExam.events),['teacher-mic','teacher-mic']);
      assert.deepEqual(errors,[]); await page.close();
      console.log('PASS: teacher upload, record, preview, discard, accept and save with retained playback rules.');
      continue;
    }
    if (scenario === 'cancel') {
      await page.getByRole('heading', { name: 'Exam could not start', exact: true }).waitFor();
      assert.equal(await page.getByText('What is the chemical symbol for sodium?', { exact: true }).count(), 0);
      assert.deepEqual(await page.evaluate(() => window.testExam.events), ['google-sign-in']);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(out, `cancelled-sign-in-${width}.png`), fullPage: true });
      await page.close();
      console.log(`PASS: ${width}px cancelled pre-exam sign-in exposes no questions and starts no lockdown (mock IPC).`);
      continue;
    }
    const unlock = page.getByRole('button', { name: 'Invigilator unlock', exact: true });
    await unlock.waitFor();
    await page.getByText('What is the chemical symbol for sodium?', { exact: true }).waitFor();
    await page.getByText('Na', { exact: true }).click();
    if (scenario === 'language') {
      await page.getByRole('button',{name:'Play clip'}).click();
      await page.getByText('0 plays left').waitFor();
      assert.equal(await page.locator('audio').first().evaluate(el=>el.playbackRate),0.75);
      await page.getByRole('button',{name:'Record answer'}).click();
      await page.getByRole('button',{name:'Stop recording'}).waitFor();
      await page.getByText('Your grade',{exact:true}).waitFor();
      assert.match(await page.evaluate(()=>window.testExam.savedAudio),/^data:audio\/webm;base64,.{100}/);
      assert.deepEqual(await page.evaluate(()=>window.testExam.events),['google-sign-in','lock','submit','turn-in']);
      assert.deepEqual(errors,[]);
      await page.close();
      console.log('PASS: listening speed/limit and deadline submission with an in-progress synthetic microphone answer');
      continue;
    }
    if (scenario === 'lms') {
      assert.deepEqual(await page.evaluate(() => window.testExam.events), ['google-sign-in', 'lock']);
      await page.getByRole('button', { name: 'Submit exam', exact: true }).click();
      await page.getByText('Your grade', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Retry grade sync', exact: true }).waitFor();
      assert.equal(await page.locator('input[type="password"]').count(), 0);
      assert.deepEqual(await page.evaluate(() => window.testExam.events), ['google-sign-in', 'lock', 'submit', 'turn-in']);
      await page.getByRole('button', { name: 'Retry grade sync', exact: true }).click();
      await page.getByText('Grade synced to Google Classroom', { exact: true }).waitFor();
      const completed = ['google-sign-in', 'lock', 'submit', 'turn-in', 'turn-in'];
      assert.deepEqual(await page.evaluate(() => window.testExam.events), completed);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: join(out, `automatic-lms-${width}.png`), fullPage: true });
      await unlock.click();
      const pin = page.getByPlaceholder('Enter invigilator PIN');
      await pin.fill('wrong');
      await page.getByRole('button', { name: 'Release student', exact: true }).click();
      await page.getByText(/Incorrect invigilator PIN\. The exam remains locked\./).waitFor();
      assert.deepEqual(await page.evaluate(() => window.testExam.events), completed);
      await pin.fill('987654');
      await page.getByRole('button', { name: 'Release student', exact: true }).click();
      await unlock.waitFor({ state: 'detached' });
      assert.deepEqual(await page.evaluate(() => window.testExam.events), [...completed, 'end-session']);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS: ${width}px sign-in precedes lockdown; Submit sends automatically without PIN/browser/release; grade retry stays locked; wrong/right final exit PINs enforced (mock IPC).`);
      continue;
    }
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
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(fixtureDirectory, { recursive: true, force: true });
}
