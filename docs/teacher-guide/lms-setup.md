# LMS Setup Guide

LOCKEDSCREEN works without Google Classroom, Microsoft 365, or any LMS. If a school only wants local secure exams, package export, and local result export, choose `Lockdown-only exam app` in `Admin Console > Overview > Package use`, save/export the package, and skip this guide.

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

Default teacher permission scopes currently used by LOCKEDSCREEN:

```text
openid email profile https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.students https://www.googleapis.com/auth/classroom.coursework.students.readonly https://www.googleapis.com/auth/classroom.rosters.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets
```

Default student permission scopes currently used by LOCKEDSCREEN:

```text
openid email profile https://www.googleapis.com/auth/classroom.coursework.me https://www.googleapis.com/auth/drive.file
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

## Package Use: Lockdown-only vs Integrations

Every package starts from `Admin Console > Overview > Package use`.

Choose `Lockdown-only exam app` when students only need the secure Lockedscreen exam runtime and local result storage. In this mode, the package omits Google Classroom, Microsoft 365, LMS turn-in, grade-sync destinations, and Google Sheets targets.

Choose `LMS / grade integrations` only when the package should connect to Google Classroom, Microsoft 365, Google Sheets, or a school-owned sync endpoint. The LMS setup tabs and grade-sync controls are intended for this mode.

## App-based Google Classroom Grade Sync

For an app-based Lockedscreen exam, grades are always calculated locally first. Google Classroom receives grades only after the package has enough Classroom information and a permitted grade-write path.

Recommended setup:

1. Open `Admin Console > Overview`.
2. Select the package for the app-based exam.
3. Set `Package use` to `LMS / grade integrations`.
4. Open `Google Classroom`.
5. Enable Google Classroom if it is not enabled.
6. In `LMS connections`, choose or create the teacher Google Classroom connection.
7. Click `Save connection`.
8. Click `Connect Google Classroom` or `Reconnect Google Classroom`.
9. Complete Google sign-in with the teacher's school account.
10. Click `Load classes` and confirm the expected class appears.
11. Open `Student turn-in`.
12. Enable `post-submit student LMS turn-in`.
13. Choose the connected teacher Google account.
14. Click `Load classes`, select the class, then click `Load assignments`.
15. Select the Google Classroom assignment, or use `Post package to class` to create the assignment from Lockedscreen.
16. Click `Set up grade sync for this class` or open `Grade sync` and click `Import Classroom details`.
17. In `Grade sync`, confirm the `Classroom course ID` and `Classroom assignment ID`.
18. Enter the school-owned `Grade-sync server URL`.
19. Set the trigger to `Auto sync after submission`.
20. Click `Save destination`.
21. Click `Save package`, then export or post the package.

The Classroom assignment ID is the Google Classroom `courseWork.id`. It is obtained automatically when the teacher selects an existing assignment from `Load assignments`, or when `Post package to class` creates a new Classroom assignment and Classroom returns the new ID. Posted packages are uploaded as downloadable `.lscp` files, not Google text/JSON documents. Students should use the Classroom download link or download the attachment, then open the downloaded `.lscp` file with Lockedscreen.

If a package is manually exported before the Classroom assignment exists, that exported file cannot contain the assignment ID. Student LMS turn-in will not work from that older exported file until the teacher selects or posts the assignment, saves the package, and exports an updated file. `Post package to class` performs this update automatically for the package it posts to Classroom.

Important: student machines should not contain teacher refresh tokens. If students take the exam on separate devices, use the `Google Classroom grade sync server` destination. The school-owned server or Apps Script web app owns teacher authorization and writes `draftGrade` / `assignedGrade` to Classroom.

If the same teacher/admin device is used for testing, Lockedscreen can attempt direct Classroom grade sync after student turn-in because the teacher connection exists locally. In normal student-package use, the server-side grade-sync destination is the reliable path.

## Microsoft 365 / Teams Grade Sync

Microsoft 365 turn-in uses the connected class and assignment in the same `Student turn-in` workflow. For grade passback, use a school-owned Microsoft Graph middleware or Power Automate flow as a `Result destination`.

Teacher-facing setup:

1. Open `Admin Console > Overview`.
2. Set `Package use` to `LMS / grade integrations`.
3. Open `Google Classroom` / `LMS connections`.
4. Choose `Microsoft 365`.
5. Save and connect the teacher account.
6. Open `Student turn-in`.
7. Enable LMS turn-in.
8. Choose the connected Microsoft 365 account, class, and assignment.
9. Open `Grade sync`.
10. Choose `Microsoft Teams` or `Generic LMS`.
11. Enter the school-owned endpoint supplied by IT.
12. Save the destination, save the package, then export it.

The Microsoft endpoint must perform the teacher/application-grade write through Microsoft Graph. Lockedscreen sends the local score payload; the school service writes the grade and returns/updates submissions according to the school's Microsoft policy.

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

## Troubleshooting

`Error 401: invalid_client` means the provider rejected the app registration, not the teacher password.

Check:

- the app registration client ID is correct
- the OAuth app/client has not been deleted or disabled
- the Google/Microsoft app type supports desktop/native sign-in
- the school admin has approved the requested permissions
- the teacher account belongs to the school tenant or Google Workspace domain expected by the app registration

If the school is not using LMS, do not configure an LMS connection. Local exams, package export/import, OCR import, and CSV result export still work.
