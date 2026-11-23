import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['apps/desktop/src/main/security/website-sign-in.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { createWebsiteSignInPolicy } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const form = 'https://docs.google.com/forms/d/e/practice/viewform';
const guard = { mode: 'link', startUrl: form, allowedDomains: ['docs.google.com'] };
const login = (url = form) => new URL('https://accounts.google.com/v3/signin/identifier?continue=' + encodeURIComponent(url) + '&service=wise');

test('Forms website login, password/2FA challenge and cookie return stay bound to the same form', () => {
  const policy = createWebsiteSignInPolicy(guard);
  assert.equal(policy.allows(new URL('https://accounts.google.com/v3/signin/challenge/pwd')), false);
  assert.equal(policy.allows(login()), true);
  assert.equal(policy.observe(login().href), 'signing-in');
  for (const path of ['/Login', '/ServiceLogin', '/ServiceLoginAuth', '/AccountChooser', '/signin/v2/challenge/pwd', '/v3/signin/challenge/totp', '/_/signin/sl/lookup']) {
    assert.equal(policy.allows(new URL('https://accounts.google.com' + path)), true, path);
  }
  assert.equal(createWebsiteSignInPolicy(guard).allows(new URL('https://accounts.google.com/Login?continue=' + encodeURIComponent(form))), true);
  const cookie = new URL('https://accounts.youtube.com/accounts/SetSID?continue=' + encodeURIComponent(form));
  assert.equal(policy.allows(cookie), true);
  assert.equal(policy.observe(form), 'exam');
  assert.equal(policy.isSigningIn(), false);
  assert.equal(policy.allows(new URL('https://accounts.google.com/v3/signin/challenge/pwd')), false);
});

test('Forms cannot use Google sign-in to reach search, mailbox, another form or an external callback', () => {
  const policy = createWebsiteSignInPolicy(guard);
  for (const target of ['https://www.google.com/search?q=answers', 'https://mail.google.com/',
    'https://myaccount.google.com/', 'https://docs.google.com/forms/d/e/another/viewform',
    'https://evil.invalid/', 'http://docs.google.com/forms/d/e/practice/viewform',
    'https://user:pass@docs.google.com/forms/d/e/practice/viewform',
    'https://docs.google.com.evil.invalid/forms/d/e/practice/viewform']) {
    assert.equal(policy.allows(login(target)), false, target);
  }
  assert.equal(policy.allows(new URL(login().href + '&continue=https://evil.invalid/')), false);
  assert.equal(policy.allows(new URL(login().href + '&followup=https://mail.google.com/')), false);
  assert.equal(policy.allows(new URL(login().href + '&redirect_uri=https://auth.whsdominica.com/oauth/google/callback')), false);
  assert.equal(policy.allows(new URL(login().href.replace('accounts.google.com', 'accounts.google.com.evil.invalid'))), false);
  assert.equal(policy.isSigningIn(), false);
});

test('nested account redirects are validated to a bounded depth', () => {
  const policy = createWebsiteSignInPolicy(guard);
  assert.equal(policy.allows(login(login().href)), true);
  assert.equal(policy.allows(login(login('https://mail.google.com/').href)), false);
  let nested = form;
  for (let i = 0; i < 7; i++) nested = login(nested).href;
  assert.equal(policy.allows(new URL(nested)), false);
});

test('Forms navigation is pinned and broad legacy Google allowlists do not add browsing exceptions', () => {
  const policy = createWebsiteSignInPolicy({ ...guard, allowedDomains: ['google.com', 'youtube.com'] });
  for (const url of [form, form.replace('viewform', 'formResponse'), form.replace('viewform', 'viewscore')]) {
    assert.equal(policy.formNavigationAllowed(new URL(url)), true);
  }
  for (const url of ['https://docs.google.com/forms/d/e/another/viewform', 'https://docs.google.com/forms/',
    'https://docs.google.com/forms/d/e/practice/edit', 'https://www.google.com/search?q=answer',
    'https://myaccount.google.com/', 'https://drive.google.com/', 'https://www.youtube.com/']) {
    assert.equal(policy.formNavigationAllowed(new URL(url)), false, url);
  }
});

test('short Forms links bind to the resolved form, then reject another form', () => {
  const policy = createWebsiteSignInPolicy({ ...guard, startUrl: 'https://forms.gle/practice-link' });
  assert.equal(policy.formNavigationAllowed(new URL('https://forms.gle/practice-link')), true);
  policy.observe(form);
  assert.equal(policy.allows(login()), true);
  assert.equal(policy.allows(login('https://docs.google.com/forms/d/e/another/viewform')), false);
  assert.equal(policy.formNavigationAllowed(new URL('https://forms.gle/different-link')), false);
});

test('provider rejection is reported as provider rejection, not a blanket app block', () => {
  const policy = createWebsiteSignInPolicy(guard);
  assert.equal(policy.allows(login()), true);
  const rejection = new URL('https://accounts.google.com/signin/rejected?rrk=46');
  assert.equal(policy.allows(rejection), true);
  assert.equal(policy.observe(rejection.href), 'provider-rejected');
});

test('website OAuth stays identity-only and cannot become publisher API OAuth inside an exam', () => {
  const policy = createWebsiteSignInPolicy({ ...guard, startUrl: 'https://assessment.example/attempt/1' });
  const oauth = new URL('https://accounts.google.com/o/oauth2/v2/auth?client_id=fictional&response_type=code&scope=openid%20email%20profile&redirect_uri=https%3A%2F%2Fassessment.example%2Fauth%2Fcallback');
  assert.equal(policy.allows(oauth), true);
  for (const [name, value] of [['redirect_uri', 'https://auth.whsdominica.com/oauth/google/callback'],
    ['redirect_uri', 'https://evil.invalid/'], ['scope', 'https://www.googleapis.com/auth/drive'], ['response_type', 'token']]) {
    const invalid = new URL(oauth); invalid.searchParams.set(name, value);
    assert.equal(policy.allows(invalid), false, name + '=' + value);
  }
  assert.equal(createWebsiteSignInPolicy(guard).allows(oauth), false);
  assert.equal(createWebsiteSignInPolicy({ ...guard, mode: 'app' }).allows(login()), false);
});
