# Google Classroom Integration Architecture

Lockedscreen separates Google Classroom integration into two data classes:

1. Admin integration configuration
   - Stored in normal Lockedscreen app state.
   - Contains non-secret deployment settings such as enabled/disabled state, the Google OAuth Desktop app client ID, requested scopes, and connection status metadata.
   - This data is safe to back up with the rest of the application configuration because it does not contain OAuth access tokens or refresh tokens.

2. Per-teacher OAuth tokens
   - Stored in the local OAuth vault, not in the app state JSON.
   - Keyed by a hash of the teacher connection ID so the vault does not expose account identifiers as JSON keys.
   - Encrypted before disk write with Electron `safeStorage`, which uses the operating system's desktop secret protection on Windows.
   - Contains access token, refresh token when issued, and access-token expiry timestamp.

OAuth flow:

1. The admin enables Google Classroom and enters the Desktop app client ID.
2. A teacher uses Connect Google Classroom.
3. Lockedscreen opens the system browser with a localhost loopback redirect URI and PKCE challenge.
4. Google redirects to `127.0.0.1`; Lockedscreen verifies `state`.
5. The authorization code is exchanged with the PKCE verifier.
6. Tokens are encrypted into the local OAuth vault.
7. Only account email/name and connection status are written to normal app state.

Token lifecycle:

- Access-token expiry is tracked inside the encrypted token bundle.
- API calls reuse the current access token until it is near expiry.
- If a refresh token is available, Lockedscreen refreshes the access token and rewrites the encrypted bundle.
- Sign out asks Google to revoke the token and then removes the encrypted local token bundle.
- Admin token reset removes the encrypted local token bundle without contacting Google, for support or recovery cases.

Security boundary:

Teacher OAuth tokens never leave the local device and are never exported in exam packages. Packages carry only selected course/assignment references needed for the exam workflow.

Student turn-in and grade passback:

- Student OAuth is used only for the student's own turn-in action. The student signs in, Lockedscreen uploads the submission artifact, attaches it to the selected Classroom assignment, and turns it in.
- Google Classroom does not allow a student OAuth token to write that student's grade. Grade write-back must use a teacher account with `https://www.googleapis.com/auth/classroom.coursework.students`.
- When the connected teacher account is available on the same Lockedscreen install, Lockedscreen patches the student's `draftGrade` and `assignedGrade` after turn-in.
- If a package is exported to a separate student device, the package still does not contain teacher tokens. In that topology, student turn-in can succeed but grade passback requires a later teacher-side sync service or the teacher connection to be present on that device.
