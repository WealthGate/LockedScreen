import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const compiled = await build({ entryPoints: ['apps/desktop/src/main/student-exam-auth.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'pre-exam-fixture', setup(builder) {
    builder.onResolve({ filter: /^electron$|^\.\/student-lms-turnin$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'electron' ? `
      import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
      const key = Buffer.alloc(32, 17);
      export const safeStorage = {
        isEncryptionAvailable: () => globalThis.preExam.encryption,
        encryptString: text => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(text), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
        decryptString: data => { const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0,12)); cipher.setAuthTag(data.subarray(12,28)); return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(); }
      };
    ` : `
      export const signInStudent = async (_binding, _parent, examSession) => { globalThis.preExam.events.push('sign-in'); if (globalThis.preExam.cancel) throw new Error('Sign-in cancelled'); if (!examSession) throw new Error('Exam authorization required'); return { accessToken: 'fictional-private-access', sessionToken: 'fictional-private-session', expiresAt: new Date(Date.now()+3600000).toISOString() }; };
      export const refreshStudentSignIn = async (_binding, tokens) => { if (globalThis.preExam.failRefresh) throw new Error('Refresh failed; lockdown remains active'); globalThis.preExam.events.push('token'); return tokens; };
      export const disconnectStudentSignIn = async () => { globalThis.preExam.events.push('disconnect'); };
    ` }));
  } }] });
const { StudentExamAuth } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const config = { id: 'package', examId: 'exam', externalDeliveryMode: 'integrations', studentLmsBinding: { enabled: true, provider: 'google-classroom', courseId: 'course', assignmentId: 'assignment' } };

test('pre-exam authorization is bound to one package, refreshes without a browser, and clears on exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'student-auth-'));
  globalThis.preExam = { events: [], encryption: true };
  const auth = new StudentExamAuth(directory);
  try {
    await auth.prepare(config, null);
    assert.equal(await auth.accessToken(config), 'fictional-private-access');
    await assert.rejects(auth.accessToken({ ...config, id: 'other' }), /unavailable/);
    await assert.rejects(auth.accessToken({ ...config, studentLmsBinding: { ...config.studentLmsBinding, assignmentId: 'other' } }), /unavailable/);
    globalThis.preExam.failRefresh = true;
    await assert.rejects(auth.accessToken(config), /lockdown remains active/);
    assert.deepEqual(globalThis.preExam.events, ['sign-in', 'token']);
    await auth.clear();
    await assert.rejects(auth.accessToken(config), /unavailable/);
    assert.deepEqual(globalThis.preExam.events, ['sign-in', 'token', 'disconnect']);
    globalThis.preExam.cancel = true;
    await assert.rejects(auth.prepare(config, null), /cancelled/);
    await assert.rejects(auth.accessToken(config), /unavailable/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('secure desktop handoff is encrypted, one-use, package-bound and does not re-open sign-in', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'student-handoff-'));
  globalThis.preExam = { events: [], encryption: true };
  const parent = new StudentExamAuth(directory), child = new StudentExamAuth(directory);
  try {
    await parent.prepare(config, null);
    const handle = await parent.createHandoff();
    assert.match(handle, /^[a-f0-9]{64}$/);
    const contents = await readFile(join(directory, handle));
    assert.equal(contents.includes(Buffer.from('fictional-private')), false);
    parent.forget();
    await child.takeHandoff(handle, config);
    assert.deepEqual(await readdir(directory), []);
    assert.equal(await child.accessToken(config), 'fictional-private-access');
    await assert.rejects(new StudentExamAuth(directory).takeHandoff(handle, config));
    assert.deepEqual(globalThis.preExam.events, ['sign-in', 'token']);
    await child.clear();
    await parent.prepare(config, null);
    const wrong = await parent.createHandoff();
    await assert.rejects(child.takeHandoff(wrong, { ...config, id: 'other' }), /does not match/);
    await assert.rejects(child.takeHandoff('../unsafe', config), /before opening/);
    globalThis.preExam.encryption = false;
    await assert.rejects(parent.createHandoff(), /protected/);
    await parent.clear();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('expired student authorization never initiates another sign-in inside an exam', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'student-expiry-'));
  globalThis.preExam = { events: [], encryption: true };
  const auth = new StudentExamAuth(directory), now = Date.now;
  try {
    await auth.prepare(config, null);
    const started = Date.now();
    Date.now = () => started + 13 * 3600000;
    await assert.rejects(auth.accessToken(config), /lockdown remains active/);
    assert.deepEqual(globalThis.preExam.events, ['sign-in']);
  } finally { Date.now = now; await auth.clear(); await rm(directory, { recursive: true, force: true }); }
});
