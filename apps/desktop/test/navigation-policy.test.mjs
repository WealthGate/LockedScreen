import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

test('hosted navigation filters redirects, programmatic loads, popups and webview privileges', async () => {
  const state = {};
  globalThis.examNavigationTest = state;
  const result = await build({ entryPoints: ['apps/desktop/src/main/security/session-controller.ts'],
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'mock-electron-navigation', setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, args => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
        export const BrowserWindow = { getAllWindows: () => [] };
        export const clipboard = { clear() {} };
        export const screen = { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) };
        const state = globalThis.examNavigationTest;
        export const session = { fromPartition: () => ({
          webRequest: { onBeforeRequest: callback => { state.request = callback; } },
          setPermissionRequestHandler: callback => { state.permission = callback; },
          on() {}
        }) };
      ` }));
    } }] });
  const controller = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  const audit = async () => {};
  const config = {
    label: 'Practice hosted exam', securityMode: 'full-kiosk',
    sessionPolicy: { clearSessionOnStart: false, clearSessionOnEnd: false }, clipboardPolicy: { mode: 'allow' },
    browserPolicy: { startUrl: 'https://exam.example/start', allowedDomains: ['exam.example'], urlRules: [
      { kind: 'prefix', pattern: 'https://portal.example/quizzes/123' },
      { kind: 'prefix', pattern: 'https://quiz.example/start?id=exam-1' }
    ] }
  };
  const contents = type => {
    const handlers = new Map(); const loaded = [];
    return { handlers, loaded, getType: () => type, setWindowOpenHandler: callback => handlers.set('popup', callback),
      on: (event, callback) => handlers.set(event, callback), loadURL: async url => loaded.push(url) };
  };
  const main = contents('window'); const guest = contents('webview');
  controller.configureHostedPartition(audit);
  controller.configureWebContents(main, audit);
  controller.configureWebContents(guest, audit);
  const request = (url, resourceType = 'mainFrame') => {
    let result;
    state.request({ url, resourceType }, value => { result = value; });
    return result;
  };
  try {
    assert.deepEqual(request('https://exam.example/start'), { cancel: true }, 'no webview navigation outside an exam');
    assert.throws(() => controller.assertExamNavigation({ ...config, browserPolicy: { ...config.browserPolicy, startUrl: 'http://exam.example/start' } }, 'link'), /HTTPS exam URL/);
    assert.throws(() => controller.assertExamNavigation({ ...config, browserPolicy: { ...config.browserPolicy, startUrl: 'https://other.example/start' } }, 'link'), /not approved/);
    await controller.beginManagedSession(null, { examId: 'exam', packageId: 'package', mode: 'link' }, config, audit);
    const cases = [
      ['https://exam.example/start', true], ['https://exam.example.evil/start', false],
      ['http://exam.example/start', false], ['file://exam.example/start', false],
      ['https://user:password@exam.example/start', false],
      ['https://portal.example/quizzes/123?attempt=1', true],
      ['https://portal.example/quizzes/123/answer', true], ['https://portal.example/quizzes/1234', false],
      ['https://portal.example.evil/quizzes/123', false],
      ['https://quiz.example/start?id=exam-1&lang=en', true], ['https://quiz.example/start?id=exam-2', false],
      ['https://www.google.com/search?q=answer', false], ['https://myaccount.google.com/', false],
      ['https://ssl.gstatic.com/anything.html', false], ['https://docs.google.com/document/d/other', false],
      ['https://accounts.google.com/o/oauth2/v2/auth', false],
      ['https://forms.gle/practice', true], ['https://docs.google.com/forms/d/e/practice/formResponse', true]
    ];
    for (const [url, allowed] of cases) {
      assert.equal(controller.urlAllowedByGuard(url), allowed, url);
      assert.deepEqual(request(url), allowed ? {} : { cancel: true }, `network enforcement: ${url}`);
    }
    assert.deepEqual(request('https://ssl.gstatic.com/forms/scripts.js', 'script'), {}, 'asset loading does not grant navigation');
    assert.deepEqual(main.handlers.get('popup')({ url: 'https://exam.example/start' }), { action: 'deny' });
    assert.equal(main.loaded.length, 0, 'root application must never be replaced with a hosted page');
    assert.deepEqual(guest.handlers.get('popup')({ url: 'https://exam.example/start' }), { action: 'deny' });
    assert.deepEqual(guest.loaded, ['https://exam.example/start']);
    let blocked = false;
    main.handlers.get('will-attach-webview')({ preventDefault() { blocked = true; } }, {}, { src: 'https://evil.example' });
    assert.equal(blocked, true);
    const preferences = { preload: 'attacker.js', nodeIntegration: true, sandbox: false, webSecurity: false };
    blocked = false;
    main.handlers.get('will-attach-webview')({ preventDefault() { blocked = true; } }, preferences, { src: config.browserPolicy.startUrl });
    assert.equal(blocked, false);
    assert.equal(preferences.preload, undefined);
    assert.equal(preferences.partition, 'persist:lockedscreen-link');
    for (const key of ['nodeIntegration', 'nodeIntegrationInSubFrames', 'allowRunningInsecureContent', 'webviewTag']) assert.equal(preferences[key], false);
    for (const key of ['contextIsolation', 'sandbox', 'webSecurity']) assert.equal(preferences[key], true);
    await controller.endManagedSession(null, 'Switch practice fixture', audit);
    const form = 'https://docs.google.com/forms/d/e/practice/viewform';
    await controller.beginManagedSession(null, { examId: 'form', packageId: 'form-package', mode: 'link' }, {
      ...config, browserPolicy: { ...config.browserPolicy, startUrl: form, allowedDomains: ['google.com', 'youtube.com'] }
    }, audit);
    const signIn = 'https://accounts.google.com/ServiceLogin?continue=' + encodeURIComponent(form);
    assert.deepEqual(request(form), {});
    assert.deepEqual(request(signIn), {}, 'Forms website sign-in must not be blanket-blocked');
    assert.deepEqual(guest.handlers.get('popup')({ url: signIn }), { action: 'deny' });
    assert.equal(guest.loaded.at(-1), signIn, 'approved sign-in opens only inside the same locked webview');
    for (const url of ['https://www.google.com/search?q=answers', 'https://mail.google.com/',
      'https://myaccount.google.com/', 'https://www.youtube.com/', 'https://docs.google.com/forms/d/e/other/viewform',
      'https://accounts.google.com/ServiceLogin?continue=https://mail.google.com/']) {
      assert.deepEqual(request(url), { cancel: true }, url);
    }
    controller.holdManagedSession('Protection failure');
    assert.deepEqual(request(config.browserPolicy.startUrl), { cancel: true }, 'paused exams must not keep navigating');
  } finally {
    await controller.endManagedSession(null, 'Test cleanup', audit);
    delete globalThis.examNavigationTest;
  }
});
