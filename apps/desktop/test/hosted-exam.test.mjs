import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const load = async options => {
  const compiled = await build({ ...options, bundle: true, platform: 'node', format: 'esm', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
};
const { isHostedFormCompletionUrl, hostedSubmissionNotice } = await load({ entryPoints: ['apps/desktop/src/renderer/lib/hosted-exam.ts'] });
test('form response URLs are strict navigation hints, never proof of provider submission', () => {
  for (const path of ['/forms/d/e/practice/formResponse', '/forms/d/practice/formResponse', '/forms/u/1/d/e/practice/formResponse/']) {
    assert.equal(isHostedFormCompletionUrl('https://docs.google.com' + path), true);
  }
  for (const url of ['http://docs.google.com/forms/d/e/test/formResponse',
    'https://docs.google.com.evil.invalid/forms/d/e/test/formResponse',
    'https://user:password@docs.google.com/forms/d/e/test/formResponse',
    'https://docs.google.com/forms/d/e/test/viewform?submit=1', 'https://example.invalid/form_confirm', 'bad url']) {
    assert.equal(isHostedFormCompletionUrl(url), false);
  }
  assert.match(hostedSubmissionNotice, /local session record only/);
  assert.match(hostedSubmissionNotice, /Submit inside the form first/);
});

test('actual main submission handler serializes saves and recovers the existing record after a response failure', async () => {
  const source = await readFile('apps/desktop/src/main/index.ts', 'utf8');
  const handler = source.slice(source.indexOf('  handleIpc("exam:submit"'), source.indexOf('  handleIpc("studentLms:turnIn"'));
  const module = await load({ stdin: { loader: 'ts', contents: `
    let activeSubmissionId = null, submissionInFlight = false, listener;
    export const state = { submissions: [], exams: [{ id: 'practice', mode: 'link' }], writes: 0, failAfterSave: false };
    const isRecord = value => !!value && typeof value === 'object';
    const isExam = value => value?.id === 'practice';
    const isSession = value => value?.examId === 'practice';
    const getActivePackage = () => ({ id: 'package', externalDeliveryMode: 'lockdown-only' });
    const getActiveSession = () => ({ examId: 'practice' });
    const withRuntime = value => value;
    const syncSubmissionResultsInternal = async () => {};
    const handleIpc = (_channel, callback) => { listener = callback; };
    const storage = {
      getSnapshot: async () => {
        if (state.failAfterSave && state.writes) { state.failAfterSave = false; throw new Error('Simulated response failure'); }
        await new Promise(resolve => setTimeout(resolve, 5));
        return structuredClone({ exams: state.exams, submissions: state.submissions });
      },
      recordSubmission: async () => {
        state.writes++;
        const result = { id: 'local-record', syncStates: [] };
        state.submissions.push(result);
        return result;
      }
    };
    ${handler}
    export const submit = payload => listener(null, payload);
  ` } });
  const payload = { exam: { id: 'practice' }, session: { examId: 'practice' } };
  module.state.failAfterSave = true;
  const first = module.submit(payload);
  await assert.rejects(module.submit(payload), /being saved/);
  await assert.rejects(first, /Simulated response failure/);
  assert.equal((await module.submit(payload)).result.id, 'local-record');
  assert.equal((await module.submit(payload)).result.id, 'local-record');
  assert.equal(module.state.writes, 1);
  await assert.rejects(module.submit({}), /Invalid submission payload/);
});
