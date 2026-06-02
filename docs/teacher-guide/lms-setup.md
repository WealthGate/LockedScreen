# LMS Setup Guide

LOCKEDSCREEN works without Google Classroom, Microsoft 365, or any LMS. If a school only wants local secure exams, package export, and local result export, skip this guide.

Use LMS setup only when the school wants one of these workflows:

- teachers choose Google Classroom or Microsoft 365 classes and assignments inside LOCKEDSCREEN
- students turn in to Google Classroom or Microsoft 365 after the local exam submission is saved
- a school-owned webhook or middleware receives results and writes them into another LMS

## Normal Teacher Workflow

After the school app connection is configured once by an admin, teachers should not enter technical OAuth values.

Teacher steps:

1. Open `Admin Console`.
2. Go to `LMS connections`.
3. Choose `Google Classroom` or `Microsoft 365`.
4. Give the connection a friendly name.
5. Click `Save connection`.
6. Click `Connect Google Classroom` or `Connect Microsoft 365`.
7. Sign in on the Google or Microsoft page with the normal school account.
8. Click `Load classes`.
9. Open `Student LMS turn-in`.
10. Choose the connected teacher account.
11. Load classes, students, and assignments.
12. Select the class and assignment.
13. Export the exam package.

Teachers should not enter:

- app registration client IDs
- permission scopes
- Microsoft tenant values
- redirect URIs
- provider token URLs
- school email/password inside LOCKEDSCREEN

The provider sign-in page handles school email, password, passkeys, MFA, Microsoft Authenticator, or school SSO.

## Admin One-Time Setup

An admin/developer performs this once per school deployment. In LOCKEDSCREEN, open `Admin/developer app registration setup` inside `LMS connections`.

### Google Classroom

Create an OAuth app registration in Google Cloud for LOCKEDSCREEN.

Recommended setup:

1. Create or choose the school's Google Cloud project.
2. Enable the Google Classroom API.
3. Configure the OAuth consent screen for the school.
4. Create an OAuth client for an installed desktop app.
5. Copy the generated client ID into `App registration client ID`.
6. Keep the default LOCKEDSCREEN permission scopes unless the school has approved a narrower set.
7. Save the connection in LOCKEDSCREEN.

Google's desktop OAuth documentation explains that Windows desktop apps can use a loopback redirect and must use a registered OAuth client. See:

- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/workspace/classroom/guides/auth

Default teacher/admin permission scopes currently used by LOCKEDSCREEN:

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/classroom.courses.readonly
https://www.googleapis.com/auth/classroom.coursework.students
https://www.googleapis.com/auth/classroom.coursework.students.readonly
https://www.googleapis.com/auth/classroom.rosters.readonly
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/classroom.coursework.me
```

Default student permission scopes currently used by LOCKEDSCREEN:

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/classroom.coursework.me
https://www.googleapis.com/auth/drive.file
```

### Microsoft 365 Education

Create an app registration in Microsoft Entra ID for the school tenant.

Recommended setup:

1. Register an application for LOCKEDSCREEN in the school tenant.
2. Configure it as a public/native client that can use the app's local callback flow.
3. Add delegated Microsoft Graph permissions for user identity, education classes, assignments, and file upload as required by the school.
4. Grant/admin-consent the permissions according to school policy.
5. Copy the application/client ID into `App registration client ID`.
6. Enter the tenant ID only when the school does not want to use the default `common` tenant behavior.
7. Keep the default LOCKEDSCREEN permission scopes unless the Microsoft admin has approved a different list.
8. Save the connection in LOCKEDSCREEN.

Microsoft's Graph permissions reference documents the Education permissions used by this flow. See:

- https://learn.microsoft.com/en-us/graph/permissions-reference

Default teacher permission scopes currently used by LOCKEDSCREEN:

```text
offline_access openid profile User.Read EduRoster.ReadBasic EduAssignments.ReadWriteBasic Files.ReadWrite
```

Default student permission scopes currently used by LOCKEDSCREEN:

```text
offline_access openid profile User.Read EduAssignments.ReadWrite Files.ReadWrite
```

## Binding An Exam Package To An LMS Assignment

After a teacher account is connected:

1. Open `Student LMS turn-in`.
2. Enable post-submit LMS turn-in.
3. Select the connected teacher account.
4. Click `Load classes`.
5. Select the class.
6. Click `Load students`.
7. Leave all students selected, or uncheck students who should not receive the test.
8. Click `Load assignments`.
9. Select the assignment.
10. Save the package and export it.

All students in the selected class are selected by default. A teacher only needs to change this when assigning to a smaller group.

## What Students See

Student flow:

1. Student opens the exported `.lscp` exam package or starts the assigned local exam.
2. Student submits locally inside LOCKEDSCREEN.
3. LOCKEDSCREEN saves the local submission first.
4. Student signs in on the Google or Microsoft page with the normal school account.
5. LOCKEDSCREEN attaches or turns in the submission to the selected assignment.

If LMS turn-in fails, the local submission remains saved. The student can retry LMS turn-in from the post-submit screen.

## Other LMS Platforms

For Canvas, Moodle, Schoology, custom portals, and other LMS platforms, use `Result destinations` unless the school has a custom integration.

Typical setup:

1. School IT creates a webhook, Apps Script, Power Automate flow, or custom API.
2. Teacher opens `Results destinations`.
3. Teacher chooses the matching destination type.
4. Teacher enters only the endpoint and token details provided by the school.
5. LOCKEDSCREEN sends local submission results to that endpoint.

In this model, the external school service writes the data into the LMS.

## Google Sheets Grade Table

Teachers do not configure Google Sheets on each student machine.

Recommended flow:

1. School IT deploys one Google Sheets sync endpoint, such as a Google Apps Script web app.
2. Admin enters that URL once in `Admin Console > Google Classroom > Advanced admin Google setup > Default Google Sheets sync URL`.
3. Teacher creates a Google Sheet for the test results.
4. Teacher opens `Grade sync`, chooses `Google Sheets`, and pastes the Sheet link.
5. Teacher enables auto-sync and exports or posts the test package.
6. The exported `.lscp` package carries the Sheet link and sync URL to student machines.
7. When students submit, LOCKEDSCREEN sends the grade to the endpoint.
8. The endpoint creates headings automatically, writes grades, and sorts by student last name.
9. For another test in the same subject/class Sheet, the endpoint keeps the same student rows and adds new exam columns.

Do not put teacher Google tokens or service account secrets into exported student packages. See `docs/google-sheets-sync-endpoint.md` for the endpoint payload and a minimal Apps Script example.

## Reusable Grade Sync Setups

Teachers can save grade-sync settings with custom names on the teacher PC.

Use this when the same school endpoint, Google Sheet pattern, Classroom grade-sync bridge, Forms quiz sync setup, Microsoft Teams endpoint, or generic LMS endpoint will be reused for several exams.

Recommended flow:

1. Open `Admin Console > Grade sync`.
2. Configure the destination once.
3. Enter a clear custom name, such as `Physics Classroom + Sheet`, `Google Forms Quiz Sync`, or `WHS Grade Sync Server`.
4. Click `Save as setup`.
5. For a new exam, open `Grade sync`, choose the saved setup, and click `Apply setup`.
6. Review the class, assignment, exam scope, and Sheet/Form links.
7. Click `Save destination`.

Reusable setups are local templates. They do not sync grades until a teacher applies them to an active result destination for an exam.

## Troubleshooting

`Error 401: invalid_client` means the provider rejected the app registration, not the teacher password.

Check:

- the app registration client ID is correct
- the OAuth app/client has not been deleted or disabled
- the Google/Microsoft app type supports desktop/native sign-in
- the school admin has approved the requested permissions
- the teacher account belongs to the school tenant or Google Workspace domain expected by the app registration

If the school is not using LMS, do not configure an LMS connection. Local exams, package export/import, OCR import, and CSV result export still work.
