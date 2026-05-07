# Lockedscreen Privacy Policy

Effective date: May 7, 2026

Lockedscreen is a Windows desktop application for secure exam delivery, classroom assignment setup, and optional learning-management-system integrations such as Google Classroom.

## Information Lockedscreen may process

Depending on how a school configures the app, Lockedscreen may process:

- Teacher account information returned by Google sign-in, such as name and email address.
- Google Classroom class, coursework, roster, and assignment information needed to connect exams to a selected class or assignment.
- Student exam information entered into the app, such as student name, candidate ID, class, answers, scores, submission time, and result sync status.
- Local app configuration, such as school settings, exam packages, allowed apps, exam start codes, and invigilator/admin settings.
- Diagnostic information needed to check kiosk or lockdown readiness on the local Windows device.

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

## Sharing of information

Lockedscreen may send exam or grade information only to destinations configured by the teacher or school administrator, such as:

- Google Classroom
- A school-managed grade-sync server
- A Google Apps Script web app configured by the school
- A Google Sheet destination configured through the school's sync process

Lockedscreen does not intentionally share student or teacher information with unrelated third parties.

## Data retention

Data retention depends on the school configuration and the local Windows installation. Schools can delete local app data, remove exam packages, clear Google tokens, disconnect integrations, or uninstall the application according to their own policies.

## Children's and student data

Lockedscreen may be used by schools for student exams. Schools are responsible for obtaining any required permissions, notices, or consents under laws and policies that apply to their students and jurisdiction.

## Contact

For privacy questions about a specific school deployment, contact the school administrator responsible for Lockedscreen.

For project questions, contact the repository owner:

https://github.com/WealthGate/LockedScreen

