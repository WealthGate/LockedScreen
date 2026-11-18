import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, join, normalize } from 'node:path';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const { getCurrentFuseWire } = require('@electron/fuses');
const yaml = require('js-yaml');
const version = JSON.parse(await readFile('apps/desktop/package.json', 'utf8')).version;
const digest = (data, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(data).digest(encoding);
const roles = { store: `apps/desktop/dist-store/${version}/win-unpacked`,
  teacher: 'apps/desktop/dist-editions/teacher/github/win-unpacked',
  student: 'apps/desktop/dist-editions/student/github/win-unpacked' };
const secrets = [];
for (const [file, json] of [[process.env.LOCKEDSCREEN_SECRET_CHECK_JSON, true], [process.env.LOCKEDSCREEN_KEY_CHECK_FILE, false]]) {
  if (!file) continue;
  const data = await readFile(file, 'utf8');
  const value = json ? JSON.parse(data).web?.client_secret : data.trim();
  assert.ok(value, 'Secret absence check requires a nonempty value');
  secrets.push(value);
}
for (const [role, directory] of Object.entries(roles)) {
  const archive = resolve(directory, 'resources/app.asar');
  const data = await readFile(archive);
  assert.equal(data.includes(Buffer.from('GOCSPX-')), false, `${role}: embedded Google secret prefix`);
  for (const secret of secrets) assert.equal(data.includes(Buffer.from(secret)), false, `${role}: embedded private value`);
  const files = asar.listPackage(archive).map(file => file.replaceAll('\\', '/'));
  for (const name of ['vite', 'electron-builder', 'minimatch', 'picomatch', 'pdf-parse']) {
    assert.equal(files.some(file => file.endsWith(`/node_modules/${name}/package.json`)), false, `${role}: build-only dependency ${name}`);
  }
  if (role === 'student') {
    for (const name of ['pdfjs-dist', '@napi-rs/canvas', 'mammoth', 'tesseract.js']) {
      assert.equal(files.some(file => file.endsWith(`/node_modules/${name}/package.json`)), false, `Student contains ${name}`);
    }
  }
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
  assert.equal(pkg.version, version);
  const main = asar.extractFile(archive, normalize(pkg.main)).toString();
  assert.ok(main.includes('Fullscreen could not be confirmed'));
  assert.ok(main.includes('studentSubmissionId'));
  const wire = await getCurrentFuseWire(resolve(directory, 'Lockedscreen.exe'));
  for (const [key, value] of [[0, 48], [1, 49], [2, 48], [3, 48], [4, 49], [5, 49]]) assert.equal(wire[key], value, `${role} fuse ${key}`);
  for (const component of ['Agent', 'Client', 'Service']) {
    for (const extension of ['dll', 'exe', 'runtimeconfig.json']) {
      const name = `Lockedscreen.Security.${component}.${extension}`;
      const native = await readFile(join(directory, 'resources/lockedscreen-security', name));
      assert.equal(digest(native), digest(await readFile(join('apps/desktop/build/store-native', name))), `${role}: stale ${name}`);
      if (extension === 'runtimeconfig.json') assert.equal(JSON.parse(native).runtimeOptions.includedFrameworks[0].version, '10.0.15');
    }
  }
  console.log(JSON.stringify({ role, version, archiveSha256: digest(data), fuses: 'pass', native: 'matches', privateValuesChecked: secrets.length, secretAbsence: 'pass' }));
}
for (const role of ['teacher', 'student', 'web']) {
  const directory = `apps/desktop/dist-editions/${role}/${role === 'web' ? '' : 'github'}`;
  const manifest = yaml.load(await readFile(join(directory, `${role === 'web' ? 'latest' : role}.yml`), 'utf8'));
  assert.equal(manifest.version, version);
  for (const entry of manifest.files) {
    assert.equal(entry.url.includes(version), true);
    const data = await readFile(join(directory, entry.url));
    assert.equal(entry.size, data.length);
    assert.equal(entry.sha512, digest(data, 'sha512', 'base64'));
    console.log(JSON.stringify({ role, artifact: entry.url, bytes: data.length, sha256: digest(data), updateManifest: 'matches' }));
  }
}
const appx = `apps/desktop/dist-store/LockedScreen-Store-${version}-x64.appx`;
console.log(JSON.stringify({ artifact: appx, bytes: (await stat(appx)).size, sha256: digest(await readFile(appx)) }));
