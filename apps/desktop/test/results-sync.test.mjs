import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['apps/desktop/src/main/results-sync.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false });
const { syncSubmissionToDestination } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('linked session records never send placeholder grades to any result destination', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('A linked record must not send numeric grades'); };
  try {
    for (const type of ['google-classroom-grade-sync', 'google-sheets', 'webhook']) {
      const result = await syncSubmissionToDestination({ id: 'external', type, enabled: true, examIds: [],
        endpointUrl: 'https://example.invalid/grades' }, { id: 'form', mode: 'link', className: '' },
        { id: 'local-record', score: 0, totalPoints: 0, percentage: 0, responses: [] });
      assert.equal(result.status, 'disabled');
      assert.match(result.lastError, /not a scored result/);
    }
  } finally { globalThis.fetch = original; }
});

test('Classroom grade bridge receives the submission ID, never a Drive attachment URL', async () => {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return Response.json({ id: 'fictional-bridge-result' });
  };
  try {
    const destination = { id: 'bridge', label: 'Practice bridge', type: 'google-classroom-grade-sync', enabled: true,
      examIds: [], endpointUrl: 'https://bridge.example.invalid/grades', authMode: 'none' };
    const exam = { id: 'practice', title: 'Practice', className: 'Practice' };
    for (const [turnIn, expected] of [
      [{ studentSubmissionId: 'actual-submission', externalReference: 'https://drive.google.com/file/d/report/view' }, 'actual-submission'],
      [{ externalReference: 'course/assignment/legacy-submission' }, 'legacy-submission'],
      [{ externalReference: 'https://drive.google.com/file/d/report/view' }, undefined]
    ]) {
      const result = await syncSubmissionToDestination(destination, exam, { id: 'local-result', responses: [], studentLmsTurnIn: turnIn });
      assert.equal(result.status, 'success');
      assert.equal(bodies.at(-1).classroom.studentSubmissionId, expected);
    }
  } finally { globalThis.fetch = original; }
});
