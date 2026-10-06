const path = require('node:path');
const fs = require('node:fs');
const { build } = require('./package.json');
const edition = process.env.LOCKEDSCREEN_EDITION;
if (!['teacher', 'student'].includes(edition)) throw new Error('Select student or teacher edition.');
const isStore = process.env.LOCKEDSCREEN_TARGET === 'store';
let identity = {
  identityName: 'WealthGate.LockedScreen',
  publisher: 'CN=BCFD90EE-508A-4A52-BE8F-96555ACE47FA',
  publisherDisplayName: 'Wealth Gate', applicationId: 'LockedScreen', displayName: 'LockedScreen'
};
if (isStore && edition === 'student') {
  if (!process.env.LOCKEDSCREEN_STUDENT_IDENTITY) throw new Error('Student Store identity file is required.');
  const registered = JSON.parse(fs.readFileSync(process.env.LOCKEDSCREEN_STUDENT_IDENTITY, 'utf8'));
  for (const key of ['identityName', 'publisher', 'publisherDisplayName', 'applicationId', 'displayName', 'storeProductId']) {
    if (typeof registered[key] !== 'string' || !registered[key].trim()) throw new Error(`Missing registered ${key}.`);
  }
  if (registered.identityName === identity.identityName) throw new Error('Student requires a separate registered Store identity.');
  identity = registered;
}
const { storeProductId, ...appxIdentity } = identity;
module.exports = {
  ...build,
  appId: edition === 'student' ? 'com.wealthgate.lockedscreen.student' : build.appId,
  productName: edition === 'student' ? 'LockedScreen Student' : build.productName,
  directories: {
    app: process.env.LOCKEDSCREEN_STAGE || path.join(__dirname, 'build/edition-app', edition),
    output: path.join(__dirname, 'dist-editions', edition, isStore ? 'store' : 'github'),
    buildResources: path.join(__dirname, 'build')
  },
  extraResources: [{ from: path.join(__dirname, 'build/store-native'), to: 'lockedscreen-security' }],
  files: ['out/**/*', 'package.json'],
  publish: isStore ? null : [{ provider: 'github', owner: 'WealthGate', repo: 'LockedScreen', channel: edition, releaseType: 'draft' }],
  win: { ...build.win, target: [{ target: isStore ? 'appx' : 'nsis', arch: ['x64'] }] },
  nsis: { ...build.nsis, include: undefined, shortcutName: edition === 'student' ? 'LockedScreen Student' : 'LockedScreen Teacher' },
  artifactName: `LockedScreen-${edition === 'student' ? 'Student' : 'Teacher'}-Setup-\${version}-\${arch}.\${ext}`,
  appx: {
    ...appxIdentity, languages: ['en-US'], minVersion: '10.0.17763.0', maxVersionTested: '10.0.26100.0',
    backgroundColor: '#FFFFFF', artifactName: `LockedScreen-${edition === 'student' ? 'Student' : 'Teacher'}-Store-\${version}-\${arch}.appx`
  }
};
