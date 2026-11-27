import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { build } from "../../../node_modules/esbuild/lib/main.js";
import initSqlJs from "sql.js";

globalThis.crypto ??= webcrypto;
const directory = await mkdtemp(join(tmpdir(), "lockedscreen-hosted-oauth-"));
const outfile = join(directory, "worker.mjs");
await build({ entryPoints: [new URL("../src/index.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")], outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent", loader: { ".md": "text" } });
const { createOAuthWorker, cleanup } = await import(pathToFileURL(outfile).href);
const googleFile = join(directory, "google.mjs");
await build({ entryPoints: [new URL("../src/google.ts", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")], outfile: googleFile, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
const { googleProvider, scopesFor } = await import(pathToFileURL(googleFile).href);
const SQL = await initSqlJs();
const schema = await readFile(new URL("../migrations/0001_oauth.sql", import.meta.url), "utf8");
const attemptSchema = await readFile(new URL("../migrations/0002_exam_attempts.sql", import.meta.url),"utf8");
const origin = "https://auth.whsdominica.com";
const secret = Buffer.alloc(32, 7).toString("base64");
const verifier = "a".repeat(43);
const sha = async (value) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64url");

function fixture() {
  const sqlite = new SQL.Database();
  sqlite.run(schema); sqlite.run(attemptSchema);
  const DB = { prepare(sql) {
    let values = [];
    const run = () => {
      const statement = sqlite.prepare(sql);
      try { statement.bind(values); return statement.step() ? statement.getAsObject() : null; }
      finally { statement.free(); }
    };
    return { bind(...args) { values = args; return this; }, async first() { return run(); }, async run() { run(); } };
  } };
  const calls = [];
  const provider = {
    async authorize(config, role, state, auth) { calls.push({ role, state, auth }); return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`; },
    async exchange(config, callback, state, auth, role) {
      assert.equal(callback.searchParams.get("code"), "approved");
      assert.ok(auth.nonce); assert.ok(auth.verifier);
      return { accessToken: "google-access-private", refreshToken: role === "teacher" || auth.examSession ? "google-refresh-private" : undefined,
        expiresAt: new Date(Date.now() + 3600000).toISOString(), profile: { email: "test@example.com", name: "Test" } };
    },
    async refresh() { calls.push("refresh"); return { accessToken: "refreshed-private", refreshToken: "google-refresh-private", expiresAt: new Date(Date.now() + 3600000).toISOString() }; },
    async revoke() { calls.push("revoked"); }
  };
  const env = { DB, GOOGLE_CLIENT_ID: "public-client", GOOGLE_CLIENT_SECRET: "publisher-private", GOOGLE_REDIRECT_URI: `${origin}/oauth/google/callback`, TOKEN_ENCRYPTION_KEY: secret };
  const worker = createOAuthWorker(provider);
  const fetch = (path, init = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
  const post = (path, value, headers = {}) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(value) });
  const start = async (role = "teacher", examSession = false) => {
    const result = await post("/v1/google/sign-in", { role, codeChallenge: await sha(verifier), examSession });
    assert.equal(result.status, 200);
    const body = await result.json();
    const redirect = await fetch(`/oauth/google/start?flow=${body.flowId}`);
    assert.equal(redirect.status, 302);
    return { ...body, cookie: redirect.headers.get("set-cookie").split(";")[0] };
  };
  return { sqlite, env, fetch, post, start, calls };
}

test("health fails closed without the encryption key", async () => {
  const f = fixture(); delete f.env.TOKEN_ENCRYPTION_KEY;
  const response = await f.fetch("/health");
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /publisher-private|google-refresh-private/);
});
test("privacy disclosure is public, uses the current source and does not change OAuth cookies", async () => {
  const f = fixture();
  delete f.env.TOKEN_ENCRYPTION_KEY;
  f.env.DB.prepare = () => { throw new Error("Public pages must not query account records."); };
  const response = await f.fetch("/privacy", { headers: { cookie: "__Host-lockedscreen-oauth=existing-browser-cookie", origin: "https://accounts.google.com" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(response.headers.get("set-cookie"), null);
  const html = await response.text();
  assert.match(html, /November 23, 2026/);
  assert.match(html, /Generic score-sync payloads do not include voice recordings/);
  assert.match(html, /Publisher-managed Google connection service/);
  assert.match(html, /Cloudflare D1/);
  assert.match(html, /expire after 30 days/);
  assert.match(html, /Limited Use/);
  assert.doesNotMatch(html, /<script\b|publisher-private|google-refresh-private/);
  assert.equal((await f.fetch("/privacy", { method: "HEAD" })).status, 200);
  assert.equal(await (await f.fetch("/privacy", { method: "HEAD" })).text(), "");
  assert.equal((await f.fetch("/privacy/")).status, 308);
  assert.equal((await f.post("/privacy", {})).status, 405);
  assert.match(await (await f.fetch("/")).text(), /href="\/privacy"/);
});
test("teacher flow binds browser state and desktop proof, encrypts secrets and redeems once", async () => {
  const f = fixture(); const flow = await f.start();
  const wrongBrowser = await f.fetch(`/oauth/google/callback?state=${flow.flowId}&code=approved`);
  assert.equal(wrongBrowser.status, 400);
  const pending = await f.post("/v1/google/claim", { flowId: flow.flowId, codeVerifier: verifier });
  assert.equal(pending.status, 202);
  const callback = await f.fetch(`/oauth/google/callback?state=${flow.flowId}&code=approved`, { headers: { cookie: flow.cookie } });
  assert.equal(callback.status, 200);
  assert.doesNotMatch(await callback.text(), /google-access-private|google-refresh-private|publisher-private/);
  const raw = Buffer.from(f.sqlite.export()).toString("latin1");
  assert.doesNotMatch(raw, /google-access-private|google-refresh-private|publisher-private|test@example.com/);
  assert.equal((await f.post("/v1/google/claim", { flowId: flow.flowId, codeVerifier: "b".repeat(43) })).status, 400);
  const claimed = await f.post("/v1/google/claim", { flowId: flow.flowId, codeVerifier: verifier });
  const result = await claimed.json();
  assert.equal(result.accessToken, "google-access-private");
  assert.match(result.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.refreshToken, undefined);
  assert.equal((await f.post("/v1/google/claim", { flowId: flow.flowId, codeVerifier: verifier })).status, 400);
  assert.equal((await f.fetch(`/oauth/google/callback?state=${flow.flowId}&code=approved`, { headers: { cookie: flow.cookie } })).status, 400);
  assert.equal((await f.post("/v1/google/access-token", {})).status, 401);
  const token = await f.post("/v1/google/access-token", {}, { Authorization: `Bearer ${result.sessionToken}` });
  assert.equal((await token.json()).accessToken, "google-access-private");
  await f.post("/v1/google/disconnect", { revoke: true }, { Authorization: `Bearer ${result.sessionToken}` });
  assert.ok(f.calls.includes("revoked"));
  assert.equal((await f.post("/v1/google/access-token", {}, { Authorization: `Bearer ${result.sessionToken}` })).status, 401);
});
test("student flow cannot receive a teacher session or persistent Google refresh token", async () => {
  const f = fixture(); const flow = await f.start("student");
  await f.fetch(`/oauth/google/callback?state=${flow.flowId}&code=approved`, { headers: { cookie: flow.cookie } });
  const result = await (await f.post("/v1/google/claim", { flowId: flow.flowId, codeVerifier: verifier })).json();
  assert.equal(result.accessToken, "google-access-private");
  assert.equal(result.sessionToken, undefined); assert.equal(result.refreshToken, undefined);
  assert.equal(f.sqlite.exec("SELECT COUNT(*) FROM oauth_sessions")[0].values[0][0], 0);
});

test("pre-exam student authorization refreshes without browser interaction, expires within twelve hours and deletes on exit", async () => {
  const f = fixture(); const before = Date.now(); const flow = await f.start("student", true);
  assert.equal(f.calls[0].role, 'student');
  assert.equal(f.calls[0].auth.examSession, true);
  await f.fetch(`/oauth/google/callback?state=${flow.flowId}&code=approved`, { headers: { cookie: flow.cookie } });
  const result = await (await f.post('/v1/google/claim', { flowId: flow.flowId, codeVerifier: verifier })).json();
  assert.match(result.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.refreshToken, undefined);
  const expiry = f.sqlite.exec('SELECT expires_at FROM oauth_sessions')[0].values[0][0];
  assert(expiry >= before + 12 * 3600000 && expiry <= Date.now() + 12 * 3600000);
  assert.doesNotMatch(Buffer.from(f.sqlite.export()).toString('latin1'), /google-refresh-private|google-access-private|test@example.com/);
  const realNow = Date.now;
  try {
    Date.now = () => before + 2 * 3600000;
    const token = await f.post('/v1/google/access-token', {}, { Authorization: `Bearer ${result.sessionToken}` });
    assert.equal((await token.json()).accessToken, 'refreshed-private');
    assert.ok(f.calls.includes('refresh'));
    await f.post('/v1/google/disconnect', { revoke: false }, { Authorization: `Bearer ${result.sessionToken}` });
    assert.equal((await f.post('/v1/google/access-token', {}, { Authorization: `Bearer ${result.sessionToken}` })).status, 401);
    assert.equal(f.calls.includes('revoked'), false);
  } finally { Date.now = realNow; }
  const config = f.env;
  const authUrl = new URL(await googleProvider.authorize(config, 'student', 'state', { verifier, nonce: 'nonce', examSession: true }));
  assert.equal(authUrl.searchParams.get('access_type'), 'offline');
  assert(authUrl.searchParams.get('scope').includes('classroom.coursework.me'));
  assert.equal(authUrl.searchParams.get('scope').includes('classroom.coursework.students'), false);
  const legacy = new URL(await googleProvider.authorize(config, 'student', 'state', { verifier, nonce: 'nonce' }));
  assert.equal(legacy.searchParams.get('access_type'), 'online');
});
test("rejects cross-origin requests, oversized bodies and arbitrary roles/scopes", async () => {
  const f = fixture();
  assert.equal((await f.post("/v1/google/sign-in", {}, { Origin: "https://attacker.example" })).status, 403);
  assert.equal((await f.post("/v1/google/sign-in", { role: "admin", codeChallenge: await sha(verifier) })).status, 400);
  assert.equal((await f.post("/v1/google/sign-in", { text: "x".repeat(5000) })).status, 413);
});
test("expired flows cannot be claimed; cleanup removes expired records", async () => {
  const f = fixture(); const flow = await f.start();
  f.sqlite.run("UPDATE oauth_flows SET expires_at = 0");
  assert.equal((await f.post("/v1/google/claim", { flowId: flow.flowId, codeVerifier: verifier })).status, 400);
  await cleanup(f.env);
  assert.equal(f.sqlite.exec("SELECT COUNT(*) FROM oauth_flows")[0].values[0][0], 0);
});
test("rate limits repeated sign-in starts", async () => {
  const f = fixture();
  for (let count = 0; count < 10; count++) assert.equal((await f.post("/v1/google/sign-in", { role: "teacher", codeChallenge: await sha(verifier) })).status, 200);
  assert.equal((await f.post("/v1/google/sign-in", { role: "teacher", codeChallenge: await sha(verifier) })).status, 429);
});

test("a shared school network can start a class of student sign-ins while teacher starts remain limited", async () => {
  const f = fixture();
  for (let count = 0; count < 35; count++) {
    assert.equal((await f.post('/v1/google/sign-in', { role: 'student', examSession: true, codeChallenge: await sha(verifier) }, { 'CF-Connecting-IP': '192.0.2.1' })).status, 200);
  }
  assert.equal(f.sqlite.exec('SELECT COUNT(*) FROM oauth_flows')[0].values[0][0], 35);
});
test("OAuth library verifies Google signature, nonce, audience and required permissions", async () => {
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const config = { GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", GOOGLE_REDIRECT_URI: `${origin}/oauth/google/callback` };
  let override = {};
  let badSignature = false;
  let granted = scopesFor("teacher").join(" ");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/certs")) return Response.json({ keys: [{ ...jwk, kid: "test-key", use: "sig", alg: "RS256" }] });
    assert.equal(String(url), "https://oauth2.googleapis.com/token");
    const now = Math.floor(Date.now() / 1000);
    const payload = encode({ iss: "https://accounts.google.com", aud: "test-client", sub: "test-subject", nonce: "nonce", email_verified: true,
      email: "test@example.com", iat: now, exp: now + 3600, ...override });
    const input = `${encode({ alg: "RS256", kid: "test-key" })}.${payload}`;
    const signature = badSignature ? Buffer.alloc(256).toString("base64url") : Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(input))).toString("base64url");
    return Response.json({ access_token: "google-test-access", refresh_token: "google-test-refresh", token_type: "Bearer", expires_in: 3600,
      id_token: `${input}.${signature}`, scope: granted });
  };
  try {
    const run = () => googleProvider.exchange(config, new URL(`${origin}/oauth/google/callback?state=expected&code=approved`), "expected", { verifier, nonce: "nonce" }, "teacher");
    assert.equal((await run()).profile.email, "test@example.com");
    override = { nonce: "wrong" }; await assert.rejects(run());
    override = { aud: "another-client" }; await assert.rejects(run());
    override = {}; badSignature = true; await assert.rejects(run());
    badSignature = false; granted = "openid email profile"; await assert.rejects(run(), /permissions/);
  } finally { globalThis.fetch = originalFetch; }
});
test.after(async () => { await rm(directory, { recursive: true, force: true }); });

test("one online attempt per signed-in account and package across devices",async()=>{
  const service=fixture();
  const original=globalThis.fetch;
  globalThis.fetch=async(_url, options)=>{
    assert.equal(options.redirect, "manual");
    return Response.json({sub:"verified-user",name:"Test Student",email:"test@example.com",email_verified:true});
  };
  const request=(path,body)=>service.fetch(path,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer synthetic"},body:JSON.stringify(body)});
  const claim=(lease,packageId="package")=>request("/v1/attempt/claim",{provider:"google",packageId,lease});
  try {
    const [a,b]=await Promise.all([claim("a".repeat(43)),claim("b".repeat(43))]);
    assert.deepEqual([a.status,b.status].sort(),[200,409]);
    const winner=a.ok?"a":"b";
    const first=await (a.ok?a:b).json();
    assert.equal(first.repeated,false);
    assert.equal((await (await claim(winner.repeat(43))).json()).repeated,true);
    assert.equal((await request("/v1/attempt/complete",{lease:first.receipt})).status,200);
    assert.equal((await claim(winner.repeat(43))).status,409);
    assert.equal((await claim(winner.repeat(43),"different-package")).status,200);
  } finally { globalThis.fetch=original; }
});
