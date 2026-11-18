# LockedScreen 0.6.56: Student and Teacher editions

## Download choice

Distribute two installers: `LockedScreen-Student-Setup-0.6.56-x64.exe` and
`LockedScreen-Teacher-Setup-0.6.56-x64.exe`. Users choose the download before
installation. These fixed-edition installers do not show the old role selector.
The old selector installed the same full payload for either choice.

Student includes secure exam delivery, teacher-sent `.lscp` import, submission,
and student LMS turn-in. It excludes document extraction/OCR dependencies and
rejects teacher administration IPC requests. Its workspace is separate from the
Teacher workspace. Teacher retains authoring, administration and exam delivery.
This separation is not protection against a local administrator modifying files.

An APPX Store installation cannot display our NSIS role selector. For smaller
Store downloads use separate listings: the existing listing remains Teacher;
register a new Student product. Do not upload both editions under the same
identity expecting Store to ask the user's role.

## Exam delivery

Updated Teacher exports include a salted PIN verifier, not the invigilator PIN.
Re-export existing exam packages using 0.6.56 before sending them to Student.
Student requires working native lockdown and the package PIN verifier; it cannot
use the Windows Home testing-mode fallback. Student exit requires the invigilator
PIN, including after submission, regardless of a package's immediate-exit option.

## Build

From the repository root, run `npm ci`, then:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-edition.ps1 -Edition teacher -Target github
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-edition.ps1 -Edition student -Target github -SkipNative
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-edition.ps1 -Edition teacher -Target store -SkipNative
```

Artifacts are under `apps/desktop/dist-editions/<edition>/<target>/`.
Native binaries remain necessary in both editions. GitHub installers require your
production signing process; a local test certificate is not public trust.
Separate `teacher.yml` and `student.yml` update channels prevent cross-edition
updates. Existing combined installations must migrate manually; do not point
their `latest.yml` channel at the Student installer.

## Update the existing Microsoft Store listing

1. In Partner Center open LockedScreen and create a new submission.
2. In Packages replace the old package with
   `LockedScreen-Teacher-Store-0.6.56-x64.appx`. Keep the existing registered
   identity and publisher. Upload the unsigned Store artifact, not a test-signed copy.
3. Update release notes: "Separate Student edition support; secure exam package
   import and invigilator-authorized exit improvements."
4. Keep the runFullTrust explanation accurate: desktop exam application with
   native Windows helpers for supervised lockdown and restoration.
5. Update testing instructions to cover export/import and invigilator PIN exit.
6. Run WACK on this new artifact and complete supervised testing before submitting
   for certification. The previous 0.6.55 WACK result does not validate 0.6.56.

## Create the Student Store listing

Reserve a Student product name in Partner Center. Copy its Product identity
details into an untracked `student-store-identity.json` using this structure:

```json
{
  "identityName": "COPY REGISTERED PACKAGE IDENTITY NAME",
  "publisher": "COPY REGISTERED PUBLISHER CN",
  "publisherDisplayName": "COPY REGISTERED PUBLISHER DISPLAY NAME",
  "applicationId": "LockedScreen",
  "displayName": "LockedScreen Student",
  "storeProductId": "COPY NEW STORE PRODUCT ID"
}
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-edition.ps1 -Edition student -Target store -StudentIdentity student-store-identity.json -SkipNative
```

Complete Student screenshots, description, age ratings and runFullTrust rationale;
upload its Student APPX only to the new Student product. Link both Store listings
from your download page so users choose before downloading. A Student Store
artifact cannot be finalized until this registered identity is supplied.

## Release checks

- Install each edition and confirm independent shortcuts/workspaces.
- Teacher: create/import an exam, configure a known invigilator PIN, export `.lscp`.
- Student: open that file from Explorer and through Open exam package.
- Confirm no teacher menus/profile switch and denied teacher backend requests.
- Start a supervised exam; test navigation, timer, native restrictions and recovery.
- Wrong PIN must not release lockdown; correct PIN must restore the desktop.
- Submit; confirm saved answers/score and any configured LMS delivery; repeat PIN exit.
- Test a package allowing immediate post-submit exit: Student must still require PIN.
- Test old packages without a PIN verifier: start must explain re-export is required.
- Run WACK separately on both Store artifacts and retain reports.

Automated tests and successful packaging do not replace these live checks. Do not
publish the draft GitHub release or submit the Store update before they pass.
