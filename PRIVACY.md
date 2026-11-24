# Lockedscreen Privacy Policy

Effective date: November 23, 2026

Lockedscreen is a Windows desktop application for secure exam delivery, classroom assignment setup, and optional learning-management-system integrations such as Google Classroom.

## Information Lockedscreen may process

Depending on how a school configures the app, Lockedscreen may process:

- Teacher or student account information returned by Google sign-in, such as name and email address.
- Google Classroom class, coursework, roster, and assignment information needed to connect exams to a selected class or assignment.
- Student exam information entered into the app, such as student name, candidate ID, class, answers, scores, submission time, and result sync status.
- For app-based language questions, a teacher may include a listening clip or enable a spoken answer. The microphone starts only when the student chooses Record. Spoken answers are stored with the local result and attached to the assigned coursework when student LMS turn-in is enabled. Generic score-sync payloads do not include voice recordings. Linked websites are not granted microphone access.
- Local app configuration, such as school settings, exam packages, allowed apps, exam start codes, and invigilator/admin settings.
- Diagnostic information needed to check kiosk or lockdown readiness on the local Windows device.
- Teachers can also record their own listening prompts. A prompt is recorded only on request. Choosing **Use recording** and saving the exam stores the audio with that question; exporting or sharing the exam distributes the prompt to its recipients.

## How information is used

Lockedscreen uses this information to:

- Let teachers connect their Google Classroom account.
- List teacher classes and assignments selected for exam setup.
- Export or connect an exam package to a selected class or assignment.
- Record student submissions and scores.
- Sync results to configured school destinations, such as Google Classroom or a school-controlled grade-sync endpoint.
- Enforce exam access rules, timing rules, and local secure-session controls.
- Help school administrators diagnose deployment and kiosk readiness.

Lockedscreen does not sell personal information.

## Google API data use

When Google Classroom or Google Drive integration is enabled, Lockedscreen uses Google API access only for the classroom and exam workflows configured by the teacher or school administrator.

Lockedscreen's use and transfer of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.

## Local storage and security

Lockedscreen is a desktop application. School configuration and exam data may be stored locally on the Windows device. OAuth tokens are intended to be stored using secure Windows storage rather than plain text files.

Exam start codes are stored as salted hashes in exported packages, not as plain text codes.

Schools are responsible for managing access to the Windows devices where Lockedscreen is installed and for configuring appropriate administrative, invigilator, and kiosk controls.

## Publisher-managed Google connection service

When publisher-managed Google connection is selected, the app connects to
`https://auth.whsdominica.com`, operated for LockedScreen using Cloudflare Workers
and Cloudflare D1. Google passwords are entered on Google's pages in the system
browser, not into LockedScreen or the connection service.

The service processes the Google account name and verified email address, temporary
authorization codes, and OAuth access and refresh tokens needed for the connection.
Teacher connection records and temporary student exam authorizations are encrypted in D1. The publisher OAuth client secret
and token encryption key are held separately as Cloudflare Secrets. The desktop keeps
an opaque per-device service credential and short-lived Google access tokens in its
OS-encrypted vault. Exam files do not contain the publisher Web client secret or the
teacher's service credential or refresh token. Student Google sign-in completes before
exam lockdown starts. Its temporary service credential is held in the desktop main
process, not exposed to the exam page or exported packages. For a separate secure
Windows desktop, a one-use handoff is encrypted with Windows protection and expires
after two minutes. The handoff file is removed when collected; abandoned expired
handoffs are cleaned on a later handoff attempt. A crash can leave an encrypted,
unusable expired file until that cleanup or local app-data deletion.

The connection service does not receive exam answers, scores, uploaded exam files,
or Classroom rosters through its OAuth endpoints. The desktop accesses Google APIs
separately for the teacher's configured classroom workflows. Other configured result
sync destinations may receive exam information as described below.

Cloudflare processes network information needed to provide and protect the hosted
service. The application uses temporary hashed rate-limit identifiers rather than
storing raw IP addresses in its D1 rate-limit table. Application invocation logging
is disabled to avoid retaining OAuth callback codes in application logs.

## Sharing of information

Lockedscreen may send exam or grade information only to destinations configured by the teacher or school administrator, such as:

- Google Classroom
- A school-managed grade-sync server
- A Google Apps Script web app configured by the school
- A Google Sheet destination configured through the school's sync process

Lockedscreen does not intentionally share student or teacher information with unrelated third parties.

Cloudflare is used as a hosting and storage provider for the optional publisher-managed
Google connection service described above. Google receives the authorization and API
requests required for the selected Google features.

## Data retention

Data retention depends on the school configuration and the local Windows installation. Schools can delete local app data, remove exam packages, clear Google tokens, disconnect integrations, or uninstall the application according to their own policies.

Publisher-managed teacher service sessions expire after 30 days and require reconnection.
Temporary sign-in records expire after at most 10 minutes, with successfully approved
handoffs available for one-time collection for 60 seconds. Expired service records are
removed by an hourly cleanup job. Students signing in before an exam receive a
temporary student-only service credential lasting at most 12 hours, so Google access
can be refreshed without opening a browser during an exam. Google refresh tokens
remain encrypted on the service and are not returned to the student desktop. Normal
invigilator exit requests deletion of the temporary service session; if the device
crashes or is offline, server expiry still applies. Older post-exam student sign-in
flows receive only a short-lived access token and no service session.

Disconnecting a hosted connection deletes its active service session when the service
is reachable. Revoking Google access also asks Google to invalidate the authorization;
it may affect other devices connected with the same Google account and client. Users
can remove LockedScreen access from their Google account permissions page. Uninstalling
the desktop app does not itself contact the service to delete a hosted session; the
session expires as described above. Infrastructure backups may remain subject to the
hosting provider's retention policies.

## Children's and student data

Lockedscreen may be used by schools for student exams. Schools are responsible for obtaining any required permissions, notices, or consents under laws and policies that apply to their students and jurisdiction.

## Contact

For privacy questions about a specific school deployment, contact the school administrator responsible for Lockedscreen.

For project questions, contact the repository owner:

https://github.com/WealthGate/LockedScreen

