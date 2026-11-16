import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const load = async (path) => {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
};

const client = { clientId: 'example.apps.googleusercontent.com', clientSecret: 'fixture-only' };

test('only explicit Google Desktop client exports are accepted', async () => {
  const { readPublisherGoogleOAuth } = await load('apps/desktop/google-oauth-build.ts');
  const dir = await mkdtemp(join(tmpdir(), 'ls-google-config-'));
  try {
    const path = join(dir, 'oauth.json');
    assert.equal(readPublisherGoogleOAuth(), null);
    await writeFile(path, JSON.stringify({ web: { client_id: client.clientId, client_secret: client.clientSecret } }));
    assert.throws(() => readPublisherGoogleOAuth(path), /Desktop app OAuth/);
    await writeFile(path, JSON.stringify({ installed: { client_id: client.clientId, client_secret: client.clientSecret, extra: true } }));
    assert.deepEqual(readPublisherGoogleOAuth(path), client);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('publisher defaults enable unauthenticated sign-in without replacing school settings', async () => {
  const { getPublisherGoogleDefaults } = await load('apps/desktop/src/main/integrations/google/publisher-google-oauth.ts');
  const fresh = { settings: { googleIntegration: { clientId: '', enabled: false } }, lmsConnections: [] };
  assert.equal(getPublisherGoogleDefaults(fresh, null), null);
  const defaults = getPublisherGoogleDefaults(fresh, client);
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.clientId, client.clientId);
  assert.equal(defaults.connectionStatus, 'disconnected');
  assert.equal(defaults.accountEmail, '');
  assert.equal(getPublisherGoogleDefaults({ ...fresh, lmsConnections: [{ provider: 'google-classroom' }] }, client), null);
  assert.equal(getPublisherGoogleDefaults({ ...fresh, settings: { googleIntegration: { ...defaults, enabled: false } } }, client), null);
});
