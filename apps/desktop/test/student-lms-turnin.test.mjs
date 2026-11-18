import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { build } from 'esbuild';

const originalFetch = globalThis.fetch;
globalThis.studentTurnInTest = {};
const compiled = await build({ entryPoints: ['apps/desktop/src/main/student-lms-turnin.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'student-lms-fixtures', setup(builder) {
    builder.onResolve({ filter: /^(electron)$|hosted-google-oauth$/ }, args => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'electron' ? `
      export class BrowserWindow {
        destroyed = false;
        webContents = { printToPDF: async () => Buffer.from('%PDF-1.4 fictional report') };
        async loadURL() {}
        isDestroyed() { return this.destroyed; }
        destroy() { this.destroyed = true; }
      }
      export const shell = { openExternal: async url => globalThis.studentTurnInTest.events.push('browser') };
    ` : `
      export const beginHostedGoogleSignIn = async (role, open) => {
        if (role !== 'student') throw new Error('Wrong OAuth role');
        globalThis.studentTurnInTest.events.push('student-oauth');
        await open('https://auth.example/fictional-flow');
        return { accessToken: 'fictional-student-token' };
      };
    ` }));
  } }] });
const { turnInSubmissionToLms } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const uiCompiled = await build({ entryPoints: ['apps/desktop/src/renderer/lib/lms-turn-in.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false });
const { needsStudentLmsTurnIn } = await import('data:text/javascript;base64,' + Buffer.from(uiCompiled.outputFiles[0].text).toString('base64'));
after(() => { globalThis.fetch = originalFetch; delete globalThis.studentTurnInTest; });

const exam = { id: 'practice', mode: 'app', title: 'Fictional practice', subject: 'Science', className: 'Practice',
  durationMinutes: 20, instructions: '', branding: { schoolName: 'Fictional School' }, appearance: {}, questions: [] };
const saved = { id: 'saved-practice', examId: exam.id, examTitle: exam.title, candidateName: 'Practice Student',
  candidateId: 'practice-student', candidateClassName: 'Practice', submittedAt: '2026-11-18T10:00:00Z',
  score: 20, totalPoints: 40, percentage: 50, responses: [], syncStates: [] };
const binding = { enabled: true, provider: 'google-classroom', googleAuthMode: 'publisher-hosted',
  clientId: '', courseId: 'course', assignmentId: 'assignment' };
const config = { studentLmsBinding: binding };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const scenario = (options = {}) => {
  const state = { events: [], requests: [], submissionState: 'CREATED', points: 100, ...options };
  globalThis.studentTurnInTest = state;
  globalThis.fetch = async (url, request = {}) => {
    state.requests.push({ url: String(url), ...request });
    if (String(url).includes('studentSubmissions?')) return json({ studentSubmissions: [{ id: 'student-submission', state: state.submissionState }] });
    if (String(url).includes('/upload/drive/')) return json({ id: 'drive-report', name: 'report.pdf', webViewLink: 'https://drive.google.com/file/d/drive-report/view' });
    if (String(url).endsWith(':modifyAttachments')) return json({});
    if (String(url).endsWith(':turnIn')) { state.submissionState = 'TURNED_IN'; return json({}); }
    if (request.method === 'PATCH') return state.failGrade ? json({ error: { message: 'Teacher grade update temporarily unavailable' } }, 503) : json({});
    if (String(url).endsWith('/courseWork/assignment')) return state.failPoints ? json({ error: { message: 'Assignment points temporarily unavailable' } }, 500) : json({ maxPoints: state.points });
    throw new Error('Unexpected network request in test');
  };
  return state;
};

test('post-release student turn-in attaches the report and grades using teacher authority and assignment points', async () => {
  const state = scenario();
  const result = await turnInSubmissionToLms(null, config, exam, saved, { teacherAccessToken: 'fictional-teacher-token' });
  assert.deepEqual(state.events, ['student-oauth', 'browser']);
  assert.equal(result.status, 'success');
  assert.equal(result.studentSubmissionId, 'student-submission');
  assert.equal(result.gradeSyncStatus, 'success');
  assert.equal(result.gradeValue, 50);
  const patch = state.requests.find(request => request.method === 'PATCH');
  assert.equal(patch.headers.Authorization, 'Bearer fictional-teacher-token');
  assert.deepEqual(JSON.parse(patch.body), { draftGrade: 50, assignedGrade: 50 });
  assert(state.requests.findIndex(request => request.url.endsWith(':turnIn')) < state.requests.indexOf(patch));
  assert.equal(saved.score, 20);
});

test('student-only devices turn in without acquiring or using teacher grading credentials', async () => {
  const state = scenario();
  const result = await turnInSubmissionToLms(null, config, exam, saved);
  assert.equal(result.status, 'success');
  assert.equal(result.gradeSyncStatus, 'skipped');
  assert.match(result.gradeSyncError, /teacher.*connection/);
  assert.equal(state.requests.some(request => request.method === 'PATCH'), false);
});

test('expired teacher authorization is a retryable grade failure, not a student submission failure', async () => {
  scenario();
  const result = await turnInSubmissionToLms(null, config, exam, saved, { teacherAccessTokenError: 'Reconnect the teacher account, then retry grade sync.' });
  assert.equal(result.status, 'success');
  assert.equal(result.gradeSyncStatus, 'failed');
  assert.match(result.gradeSyncError, /Reconnect/);
  assert.equal(needsStudentLmsTurnIn(binding, result), true);
});

test('retrying a failed grade does not duplicate an already turned-in attachment', async () => {
  const state = scenario({ failGrade: true });
  const first = await turnInSubmissionToLms(null, config, exam, saved, { teacherAccessToken: 'fictional-teacher-token' });
  assert.equal(first.status, 'success');
  assert.equal(first.gradeSyncStatus, 'failed');
  state.failGrade = false;
  const result = await turnInSubmissionToLms(null, config, exam, saved, { teacherAccessToken: 'fictional-teacher-token' });
  assert.equal(result.gradeSyncStatus, 'success');
  assert.equal(state.requests.filter(request => request.url.includes('/upload/drive/')).length, 1);
  assert.equal(state.requests.filter(request => request.url.endsWith(':modifyAttachments')).length, 1);
});

test('unavailable points, ungraded assignments and unscored results never overwrite Classroom with a raw or zero grade', async () => {
  for (const options of [{ failPoints: true }, { points: 0 }, { unscored: true }]) {
    const state = scenario(options);
    const result = await turnInSubmissionToLms(null, config, exam, options.unscored ? { ...saved, score: 0, totalPoints: 0 } : saved,
      { teacherAccessToken: 'fictional-teacher-token' });
    assert.equal(result.status, 'success');
    assert.equal(result.gradeSyncStatus, 'failed');
    assert.equal(state.requests.some(request => request.method === 'PATCH'), false);
  }
});

test('missing LMS assignment configuration does not open Google and does not mutate the saved result', async () => {
  const state = scenario();
  await assert.rejects(turnInSubmissionToLms(null, { studentLmsBinding: { ...binding, assignmentId: '' } }, exam, saved), /missing.*assignment/);
  assert.deepEqual(state.events, []);
  assert.equal(saved.score, 20);
  assert.equal(needsStudentLmsTurnIn({ ...binding, enabled: false }, undefined), false);
  assert.equal(needsStudentLmsTurnIn(binding, { status: 'success', gradeSyncStatus: 'success' }), false);
  assert.equal(needsStudentLmsTurnIn({ ...binding, provider: 'microsoft-365' }, { status: 'success' }), false);
});
