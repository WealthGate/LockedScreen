import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['apps/desktop/src/main/integrations/google/google-classroom-service.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false
});
const { GoogleClassroomService } = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);
const settings = {
  requestedScopes: ['https://www.googleapis.com/auth/classroom.coursework.students', 'https://www.googleapis.com/auth/drive.file']
};
const request = { courseId: 'class-test', title: 'Exam', description: '', fileName: 'exam.lscp', packageJson: () => '{}' };
const invoke = () => new GoogleClassroomService({ getAccessToken: async () => 'fake-token' })
  .publishPackageCourseWork('connection', settings, request);
const successes = [{ id: 'file' }, { id: 'draft' }, { id: 'file' }, { id: 'draft', state: 'PUBLISHED' }];
const originalFetch = globalThis.fetch;

for (const [step, status, code, reason, advice] of [
  ['Drive upload', 403, 'PERMISSION_DENIED', 'SERVICE_DISABLED', /enable the Google Drive API/],
  ['Classroom draft creation', 400, 'FAILED_PRECONDITION', 'AttachmentNotVisible', /open the Drive attachment/],
  ['Drive package update', 404, 'NOT_FOUND', '', /exam file still exists in Drive/],
  ['Classroom publication', 503, 'UNAVAILABLE', '', /Check Drive and Classroom Classwork/]
]) {
  test(`${step} reports its status without exposing the raw error payload`, async (t) => {
    t.after(() => { globalThis.fetch = originalFetch; });
    const index = ['Drive upload', 'Classroom draft creation', 'Drive package update', 'Classroom publication'].indexOf(step);
    let count = 0;
    globalThis.fetch = async () => {
      const i = count++;
      return i === index
        ? Response.json({ error: { status: code, message: 'private-raw-details', details: [{ reason }] } }, { status })
        : Response.json(successes[i]);
    };
    await assert.rejects(invoke(), ({ message }) => {
      assert.ok(message.startsWith(`${step} failed`));
      assert.ok(message.includes(`HTTP ${status}, ${code}`));
      if (reason) assert.ok(message.includes(reason));
      assert.match(message, advice);
      assert.doesNotMatch(message, /private-raw-details|fake-token|could not load classes/i);
      return true;
    });
    assert.equal(count, index + 1);
  });
}

test('network failures and missing draft IDs identify the correct stage', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { throw new Error('private-raw-details'); };
  await assert.rejects(invoke(), /Drive upload failed: LockedScreen did not receive a response/);
  let count = 0;
  globalThis.fetch = async () => Response.json(count++ === 0 ? successes[0] : {});
  await assert.rejects(invoke(), /Classroom draft creation did not return an assignment ID/);
  assert.equal(count, 2);
});

test('posting still returns the published assignment and updated Drive file', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  let count = 0;
  const contexts = [];
  globalThis.fetch = async (_, options) => {
    const step = count++;
    if (step === 1) {
      assert.deepEqual(JSON.parse(options.body).materials, [
        { driveFile: { driveFile: { id: 'file' }, shareMode: 'VIEW' } }
      ]);
    }
    if (step === 2) assert.match(options.body, /"assignmentId":"draft"/);
    return Response.json(successes[step]);
  };
  const service = new GoogleClassroomService({ getAccessToken: async () => 'fake-token' });
  const published = await service.publishPackageCourseWork('connection', settings, {
    ...request,
    packageJson: (draft) => {
      contexts.push(draft?.id ?? null);
      return JSON.stringify({ assignmentId: draft?.id });
    }
  });
  assert.equal(published.driveFileId, 'file');
  assert.equal(published.courseWork.id, 'draft');
  assert.equal(published.courseWork.state, 'PUBLISHED');
  assert.equal(count, 4);
  assert.deepEqual(contexts, [null, 'draft']);
});
