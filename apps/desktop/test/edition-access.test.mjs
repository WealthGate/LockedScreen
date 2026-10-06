import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const load = async (edition) => {
  const result = await build({ entryPoints: ['apps/desktop/src/main/edition.ts'], bundle: true,
    platform: 'node', format: 'esm', write: false,
    define: { __LOCKEDSCREEN_EDITION__: JSON.stringify(edition) } });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
};

test('Student edition denies teacher operations and unknown future endpoints', async () => {
  const { buildEdition, assertRoleAccess } = await load('student');
  assert.equal(buildEdition, 'student');
  for (const channel of ['exam:save', 'exam:delete', 'settings:save', 'security:save',
    'configPackage:export', 'configPackage:save', 'configPackage:publishToClassroom',
    'results:exportCsv', 'lmsConnection:connect', 'future:admin']) {
    assert.throws(() => assertRoleAccess('student', channel), /Teacher edition/);
  }
  for (const channel of ['configPackage:import', 'session:begin', 'session:launchAlternateDesktop',
    'session:end', 'exam:submit', 'studentLms:turnIn']) {
    assert.doesNotThrow(() => assertRoleAccess('student', channel));
  }
});

test('Teacher retains authoring and can take examinations', async () => {
  const { assertRoleAccess } = await load('teacher');
  for (const channel of ['exam:save', 'configPackage:import', 'session:begin', 'exam:submit']) {
    assert.doesNotThrow(() => assertRoleAccess('teacher', channel));
  }
});

test('Student exit PIN verifier rejects incorrect and missing PINs', async () => {
  const result = await build({ entryPoints: ['apps/desktop/src/main/security/invigilator-pin.ts'],
    bundle: true, platform: 'node', format: 'esm', write: false });
  const { createPinVerifier, verifyInvigilatorPin } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  const verifier = createPinVerifier('test-pin-8371');
  assert.equal(verifyInvigilatorPin('test-pin-8371', verifier), true);
  assert.equal(verifyInvigilatorPin('wrong', verifier), false);
  assert.equal(verifyInvigilatorPin(undefined, verifier), false);
  assert.equal(verifyInvigilatorPin('test-pin-8371', undefined), false);
  assert.notEqual(createPinVerifier('test-pin-8371').salt, verifier.salt);
  assert.throws(() => createPinVerifier(' '), /Set an invigilator/);
});

test('Teacher exam packages remain readable without document import modules', async () => {
  const result = await build({ entryPoints: ['apps/desktop/src/main/security/package-crypto.ts'],
    bundle: true, platform: 'node', format: 'esm', write: false,
    alias: {
      '@lockedscreen/storage': './packages/storage/src/index.ts',
      '@lockedscreen/exam-engine': './packages/exam-engine/src/index.ts'
    } });
  const { protectConfigPackage, unprotectConfigPackage, automaticPackagePassword } =
    await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  const exam = { id: 'test-exam', title: 'Fictional test', mode: 'app', questions: [] };
  const config = { id: 'test-package', examId: exam.id, label: 'Fictional package',
    browserPolicy: {}, sessionPolicy: {}, integrity: { algorithm: 'sha256', checksum: '' } };
  const file = JSON.parse(JSON.stringify(protectConfigPackage(config, automaticPackagePassword, exam)));
  const opened = unprotectConfigPackage(file, automaticPackagePassword);
  assert.deepEqual(opened.exam, exam);
  assert.equal(opened.configPackage.examId, exam.id);
});
