# Google Classroom quick start

No Classroom account is needed for local exams. To use local exams only, select
**Admin Console > Overview > Lockdown-only exam app** and skip this guide.

## Teachers: connect once

1. In LockedScreen, open **Admin Console > Overview**, select the exam package,
   then select **LMS / grade integrations**.
2. Open **Google Classroom**. Under **LMS connections** select **Connect Google
   Classroom**. Sign in with the school account you use at
   [Google Classroom](https://classroom.google.com/) and review the permissions.
3. Back in LockedScreen, check that **Classroom classes** shows your classes.
   Publisher-configured builds do not need a school OAuth client. If school
   policy blocks sign-in, ask your Workspace administrator to approve
   LockedScreen. On builds without a publisher client, follow the school
   setup below. Do not enter your Google password into LockedScreen.

## Teachers: set up each exam

1. Open **Student turn-in** for the selected exam package. Enable turn-in, select
   **Google Classroom**, then choose your connected account and class.
2. Choose an existing assignment and **Save package**, or use **Post package to
   class** to create a new assignment and attach the exam file. Verify the
   assignment and its attachment in Classroom before sharing it.
3. Have a practice student download and open the `.lscp` file in LockedScreen,
   submit an answer, and check the turn-in in Classroom. LockedScreen saves
   scores locally; posting the exam does not configure automatic grade sync.
   For grades from separate student PCs, see the
   [school-managed grade-sync setup](lms-setup.md#app-based-google-classroom-grade-sync).

Always export a fresh exam file after changing exam settings. Do not send
teacher credentials or the invigilator PIN to students.

## Optional school-managed OAuth client

1. Create or select a school-owned [Google Cloud project](https://console.cloud.google.com/).
   Enable the [Classroom API](https://console.cloud.google.com/apis/library/classroom.googleapis.com)
   and, for posting attachments, the [Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com).
2. Configure the [OAuth consent screen](https://console.cloud.google.com/auth/overview)
   for the school, then create a [Desktop app OAuth client](https://console.cloud.google.com/auth/clients).
   Follow [Google's desktop OAuth guide](https://developers.google.com/identity/protocols/oauth2/native-app).
   Have your Workspace administrator approve access if the school's policy
   blocks the app; do not bypass Google verification or school restrictions.
3. In LockedScreen open **Admin Console > Google Classroom > Advanced admin Google setup**.
   Enable Google Classroom, enter the approved desktop client details, and
   select **Save settings**. Leave permissions at the app defaults unless your
   school has approved a different set. Complete setup on each teacher PC
   that needs Classroom; do not copy a signed-in teacher profile to student PCs.

For permissions, reconnection, and automated grades, see the
[full LMS setup guide](lms-setup.md).
