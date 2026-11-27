# Publisher-Managed Google OAuth

## Security Boundary

The new publisher-managed Web OAuth client secret belongs only in Cloudflare Secrets.
The APPX and exam packages contain a public client ID and the fixed service address,
not that client secret. The service uses oauth4webapi for PKCE and OpenID Connect
validation, including issuer, audience, nonce, expiry, and Google JWT signature.

Google refresh tokens are AES-256-GCM encrypted in D1 with record-specific authenticated
context. The encryption key is a separate Cloudflare Secret. The desktop receives a
short-lived Google access token and an opaque, per-device service credential held in
Electron's OS-encrypted vault. This is not a claim that all local user tokens are
impossible for the local user or a compromised PC to extract.

An exam remains locked until invigilator release, even after local submission.
Publisher-managed student Google turn-in deliberately requires the invigilator PIN
before ending native/managed lockdown and opening the system browser. Incorrect or
missing PINs never open the browser. Teacher connection is blocked during active exams.
No Google browser is opened automatically on submission. This post-submit release is
intentional and must be included in supervised acceptance testing.

Student sign-in receives only student scopes and no persistent service session or
Google refresh token. Exported packages contain no teacher session credentials.
Student Classroom turn-in and teacher-authorized grade writing are separate operations:
cross-device automatic grade writing still needs a configured, authenticated grade-sync
bridge (see `server-grade-sync.md`); this service does not blindly accept student scores
or expose teacher tokens through exported packages.

## Cloudflare Configuration

Worker: `lockedscreen-oauth`; domain: `auth.whsdominica.com`.
The committed `services/google-oauth/wrangler.jsonc` mirrors the dashboard's public
variables, custom domain and `DB` binding. `keep_vars` preserves dashboard variables.
Secrets must never be added to `vars`, source files, or GitHub. Preview URLs are disabled;
use separate test resources before enabling previews. Invocation logging is disabled
because callback URLs contain one-use authorization codes.

Production variables:

| Name | Type |
| --- | --- |
| GOOGLE_CLIENT_ID | Text: the publisher Web client ID |
| GOOGLE_REDIRECT_URI | Text: https://auth.whsdominica.com/oauth/google/callback |
| GOOGLE_CLIENT_SECRET | Secret: from the Web client JSON, not the old Desktop JSON |
| TOKEN_ENCRYPTION_KEY | Secret: base64 encoding of 32 cryptographically random bytes |
| DB | D1 binding: lockedscreen-oauth |

Run `scripts/prepare-oauth-key.ps1` once to prepare a private, Git-ignored key file with
Windows access limited to the current user and SYSTEM. Do not replace a production key
without a token migration plan. Losing it requires all teachers to reconnect.

## Deploy

Use Node.js 22.12 or newer for Wrangler. Install service dependencies with
`npm ci --prefix services/google-oauth` (normal install scripts are required for Wrangler's
native runtime). Use the bundled Codex Node runtime where available.

From the repository root:

```powershell
node services/google-oauth/node_modules/wrangler/bin/wrangler.js login --use-keyring
node services/google-oauth/node_modules/wrangler/bin/wrangler.js d1 migrations apply lockedscreen-oauth --remote --config services/google-oauth/wrangler.jsonc
Get-Content -LiteralPath tmp/oauth-token-encryption-key.txt -Raw | node services/google-oauth/node_modules/wrangler/bin/wrangler.js secret put TOKEN_ENCRYPTION_KEY --config services/google-oauth/wrangler.jsonc
node services/google-oauth/node_modules/wrangler/bin/wrangler.js deploy --config services/google-oauth/wrangler.jsonc
```

Keep the existing `GOOGLE_CLIENT_SECRET` dashboard Secret. No Google credential JSON is
needed in the repository. Do not deploy to a temporary Wrangler account. Apply the
idempotent schema migration only to the specified publisher D1 database.

The browser editor alternative uses the generated `services/google-oauth/dist/worker.js`
from `node scripts/build-oauth-service.mjs`; apply `migrations/0001_oauth.sql` in the D1
console. Configure the hourly cleanup trigger separately if not deploying with Wrangler.

`GET https://auth.whsdominica.com/health` must report `ready`. This only checks configuration
and schema, not a successful Google grant. Then test a real teacher connection, reconnect
after token expiry, class listing, posting, exported assignment ID, and grade delivery.
Verify project `lockedscreen` remains External/In production, required APIs are enabled,
and Google has approved the requested sensitive scopes before broad distribution.
Production publishing status alone is not sensitive-scope verification.

## Public Privacy Disclosure

The current repository `PRIVACY.md` is published as readable HTML at
https://auth.whsdominica.com/privacy. The service root provides brief product information
and a link to that policy. These pages do not require an account, a working D1 database,
or an OAuth grant, and do not set or clear the application's OAuth browser cookie.
Use that policy URL in Google Branding and the Microsoft Store privacy field; publishing
the Worker does not edit either external dashboard setting.

The complete hands-on test sequence is in
[0.6.61 Acceptance Test](releases/v0.6.61-acceptance-guide.md). Run
`scripts/prepare-store-test-shortcut.ps1` to prepare a separate-data local test shortcut.
This does not install or certify the APPX and is not a substitute for a Store package flight.

## Store Candidate 0.6.61

Build `scripts/build-store.ps1` for the existing `WealthGate.LockedScreen` listing. This is
one full selectable-role APPX. Store installation does not run our web installer's custom
role/download chooser; role selection happens in the app. Optional Store content delivery
would require a separate supported optional-package design and Store approval.

Before uploading, run WACK against this exact APPX and perform live supervised tests.
Check wrong/missing invigilator PINs, native shortcut restrictions before and after
submission, correct-PIN release, restored desktop controls, and successful Google turn-in.
The previous version's WACK result does not validate a newly built package.
Microsoft signs the accepted Store package; a local unsigned APPX is not already Store-certified.

In Partner Center, open the existing app, create an update submission, replace the package
under Packages with the new APPX, and supply updated reviewer instructions. Submit only
after the hosted service and real-account/lockdown checks pass. Store-managed users receive
the approved update through Microsoft Store; GitHub publication does not update Store apps.
