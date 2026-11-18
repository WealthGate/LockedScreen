const { build } = require('./package.json');

module.exports = {
  ...build,
  productName: 'LockedScreen',
  directories: { ...build.directories, output: 'dist-store' },
  publish: null,
  win: { ...build.win, target: [{ target: 'appx', arch: ['x64'] }] },
  extraResources: [{ from: 'build/store-native', to: 'lockedscreen-security' }],
  appx: {
    identityName: 'WealthGate.LockedScreen',
    publisher: 'CN=BCFD90EE-508A-4A52-BE8F-96555ACE47FA',
    publisherDisplayName: 'Wealth Gate',
    applicationId: 'LockedScreen',
    displayName: 'LockedScreen',
    languages: ['en-US'],
    minVersion: '10.0.17763.0',
    maxVersionTested: '10.0.26100.0',
    backgroundColor: '#FFFFFF',
    artifactName: 'LockedScreen-Store-${version}-${arch}.appx'
  }
};
