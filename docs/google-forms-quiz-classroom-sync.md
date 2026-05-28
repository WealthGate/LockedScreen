# Google Forms Quiz Score to Google Classroom Sync

This guide is for link-based exams that use a Google Form quiz. Lockedscreen cannot safely read a student's Google Forms score from the embedded exam browser. The reliable path is to let Google Forms grade the quiz, then let a Google Apps Script attached to the Form read the submitted quiz score and write it to Google Classroom.

Google Apps Script `FormResponse` supports reading gradable item responses and item scores. Google Classroom stores grades on `StudentSubmission` as `draftGrade` and `assignedGrade`, updated through the Classroom API `studentSubmissions.patch` endpoint.

Official references:

- Apps Script FormResponse: https://developers.google.com/apps-script/reference/forms/form-response
- Apps Script ItemResponse score: https://developers.google.com/apps-script/reference/forms/item-response
- Classroom grades: https://developers.google.com/classroom/guides/key-concepts/grades
- Classroom update grades: https://developers.google.com/classroom/guides/classroom-api/manage-grades

## When to Use This

Use this when:

1. The exam is a Google Forms quiz.
2. Students sign in with school Google accounts.
3. The Form already records the score in Google Forms responses.
4. The teacher wants the score to appear in the matching Google Classroom assignment.

This does not replace the Lockedscreen app-based exam grade sync. It covers Google Forms quizzes, where Google Forms owns the score.

## Using Classroom and Google Sheets Together

The script can write to Google Classroom and keep a Google Sheets gradebook copy from the same Google Form submission.

- To use Classroom only, set `courseId` and `courseWorkId`, then leave `spreadsheetId` blank.
- To use Classroom and Sheets together, set `courseId`, `courseWorkId`, and `spreadsheetId`.
- To use Sheets only, use the separate Google Sheets sync endpoint guide for app-based Lockedscreen exams.

For app-based Lockedscreen exams, teachers can also use both destinations at the same time in the app: create one `Google Classroom grade sync server` destination and one `Google Sheets` destination, set both to `Auto sync after submission`, enable both, and select the same exam scope.

## Required Google Form Settings

1. Make the Form a quiz.
2. Collect email addresses.
3. Restrict to school accounts if the school requires it.
4. Use the same Google Classroom class and assignment that the teacher selected in Lockedscreen.

The student's Google email is the safest match key for Google Forms quiz sync.

## Setup Steps

1. Open the Google Form used for the exam.
2. Click the three-dot menu.
3. Click `Script editor`.
4. Paste the `Code.gs` script below.
5. Update the `CONFIG` values.
6. Click `Project Settings`.
7. Enable `Show appsscript.json manifest file in editor`.
8. Open `appsscript.json` and paste the manifest below.
9. Save the project.
10. Run `installLockedscreenFormSubmitTrigger` once.
11. Approve the permissions as the teacher/admin account that owns the Classroom class.
12. Submit one test response from a student account and confirm the grade appears in Classroom.

Do not use `Run` on `onLockedscreenFormSubmit`. It needs the Form submit event. Run only the installer function manually.

## Code.gs

```javascript
const CONFIG = {
  // Google Classroom course ID. In Lockedscreen this is the selected class/course ID.
  courseId: "PASTE_CLASSROOM_COURSE_ID",

  // Google Classroom coursework/assignment ID. In Lockedscreen this is the selected assignment ID.
  courseWorkId: "PASTE_CLASSROOM_ASSIGNMENT_ID",

  // Optional. If blank, the script tries to use the Classroom coursework maxPoints.
  // Set this if the Form quiz total and Classroom max points should be mapped manually.
  classroomMaxPoints: "",

  // Optional gradebook copy. Leave blank if you only want Classroom grade sync.
  spreadsheetId: "",
  sheetName: "Form Quiz Scores"
};

function installLockedscreenFormSubmitTrigger() {
  const form = FormApp.getActiveForm();
  ScriptApp.newTrigger("onLockedscreenFormSubmit")
    .forForm(form)
    .onFormSubmit()
    .create();
}

function onLockedscreenFormSubmit(e) {
  if (!e || !e.response) {
    throw new Error("This function must be called by a Google Forms submit trigger.");
  }

  const form = FormApp.getActiveForm();
  const formResponse = e.response;
  const studentEmail = String(formResponse.getRespondentEmail() || "").trim();
  if (!studentEmail) {
    throw new Error("The Google Form must collect student email addresses.");
  }

  const grade = readQuizGrade(form, formResponse);
  const classroom = syncGradeToClassroom(studentEmail, grade);
  writeGradebookRow(form, formResponse, studentEmail, grade, classroom);
}

function readQuizGrade(form, formResponse) {
  const gradableResponses = formResponse.getGradableItemResponses();
  let score = 0;
  let totalPoints = 0;

  gradableResponses.forEach(function (itemResponse) {
    const itemScore = Number(itemResponse.getScore());
    if (Number.isFinite(itemScore)) {
      score += itemScore;
    }

    const points = getItemPoints(itemResponse.getItem());
    if (Number.isFinite(points)) {
      totalPoints += points;
    }
  });

  if (!Number.isFinite(totalPoints) || totalPoints <= 0) {
    totalPoints = Number(CONFIG.classroomMaxPoints || 0);
  }

  if (!Number.isFinite(totalPoints) || totalPoints <= 0) {
    totalPoints = Math.max(score, 1);
  }

  return {
    score: roundGrade(score),
    totalPoints: roundGrade(totalPoints),
    percentage: roundGrade((score / totalPoints) * 100),
    submittedAt: formResponse.getTimestamp().toISOString()
  };
}

function getItemPoints(item) {
  try {
    switch (item.getType()) {
      case FormApp.ItemType.CHECKBOX:
        return item.asCheckboxItem().getPoints();
      case FormApp.ItemType.MULTIPLE_CHOICE:
        return item.asMultipleChoiceItem().getPoints();
      case FormApp.ItemType.LIST:
        return item.asListItem().getPoints();
      case FormApp.ItemType.TEXT:
        return item.asTextItem().getPoints();
      case FormApp.ItemType.PARAGRAPH_TEXT:
        return item.asParagraphTextItem().getPoints();
      case FormApp.ItemType.SCALE:
        return item.asScaleItem().getPoints();
      case FormApp.ItemType.GRID:
        return item.asGridItem().getPoints();
      case FormApp.ItemType.CHECKBOX_GRID:
        return item.asCheckboxGridItem().getPoints();
      default:
        return 0;
    }
  } catch (error) {
    return 0;
  }
}

function syncGradeToClassroom(studentEmail, grade) {
  const submission = findStudentSubmission(studentEmail);
  const classroomMaxPoints = Number(CONFIG.classroomMaxPoints || readClassroomMaxPoints() || grade.totalPoints);
  const classroomGrade = classroomMaxPoints > 0
    ? roundGrade((grade.score / grade.totalPoints) * classroomMaxPoints)
    : grade.score;

  const url =
    "https://classroom.googleapis.com/v1/courses/" +
    encodeURIComponent(CONFIG.courseId) +
    "/courseWork/" +
    encodeURIComponent(CONFIG.courseWorkId) +
    "/studentSubmissions/" +
    encodeURIComponent(submission.id) +
    "?updateMask=draftGrade,assignedGrade";

  const response = UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + ScriptApp.getOAuthToken()
    },
    payload: JSON.stringify({
      draftGrade: classroomGrade,
      assignedGrade: classroomGrade
    }),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error("Classroom grade update failed: " + status + " " + response.getContentText());
  }

  return {
    studentSubmissionId: submission.id,
    classroomGrade: classroomGrade,
    classroomMaxPoints: classroomMaxPoints
  };
}

function findStudentSubmission(studentEmail) {
  const url =
    "https://classroom.googleapis.com/v1/courses/" +
    encodeURIComponent(CONFIG.courseId) +
    "/courseWork/" +
    encodeURIComponent(CONFIG.courseWorkId) +
    "/studentSubmissions?userId=" +
    encodeURIComponent(studentEmail) +
    "&pageSize=1";

  const response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      Authorization: "Bearer " + ScriptApp.getOAuthToken()
    },
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error("Classroom submission lookup failed: " + status + " " + response.getContentText());
  }

  const body = JSON.parse(response.getContentText() || "{}");
  if (!body.studentSubmissions || body.studentSubmissions.length === 0) {
    throw new Error("No Classroom student submission found for " + studentEmail + ".");
  }

  return body.studentSubmissions[0];
}

function readClassroomMaxPoints() {
  const url =
    "https://classroom.googleapis.com/v1/courses/" +
    encodeURIComponent(CONFIG.courseId) +
    "/courseWork/" +
    encodeURIComponent(CONFIG.courseWorkId);

  const response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      Authorization: "Bearer " + ScriptApp.getOAuthToken()
    },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    return null;
  }

  const body = JSON.parse(response.getContentText() || "{}");
  const maxPoints = Number(body.maxPoints);
  return Number.isFinite(maxPoints) && maxPoints > 0 ? maxPoints : null;
}

function writeGradebookRow(form, formResponse, studentEmail, grade, classroom) {
  if (!CONFIG.spreadsheetId) {
    return;
  }

  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(CONFIG.sheetName) || spreadsheet.insertSheet(CONFIG.sheetName);

  ensureHeaders(sheet, [
    "Submitted At",
    "Student Email",
    "Form Title",
    "Score",
    "Total Points",
    "Percentage",
    "Classroom Grade",
    "Classroom Max Points",
    "Classroom Student Submission ID",
    "Form Response ID"
  ]);

  sheet.appendRow([
    grade.submittedAt,
    studentEmail,
    form.getTitle(),
    grade.score,
    grade.totalPoints,
    grade.percentage,
    classroom.classroomGrade,
    classroom.classroomMaxPoints,
    classroom.studentSubmissionId,
    formResponse.getId()
  ]);
}

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return;
  }

  const existing = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  headers.forEach(function (header) {
    if (existing.indexOf(header) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
    }
  });
}

function roundGrade(value) {
  return Math.round(Number(value) * 100) / 100;
}
```

## appsscript.json

```json
{
  "timeZone": "America/Dominica",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/forms.currentonly",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/classroom.coursework.students",
    "https://www.googleapis.com/auth/spreadsheets"
  ]
}
```

## How Matching Works

The script uses the student's collected Google Forms email address to find that student's Classroom submission:

```text
courses/{courseId}/courseWork/{courseWorkId}/studentSubmissions?userId={studentEmail}
```

Then it writes `draftGrade` and `assignedGrade` to that specific Classroom submission.

This means the Form must collect the same school Google email that belongs to the student in Google Classroom.

## Common Problems

- `No Classroom student submission found`: the Form respondent email is not a student in that Classroom assignment, or the assignment was not posted to the student.
- `Classroom grade update failed: 403`: the script owner does not have teacher permission for that Classroom class, or the required Classroom scope was not approved.
- Score is `0`: the Form is not a quiz, questions are not auto-graded, or the response needs manual grading first.
- Personal Gmail does not match: use school Google accounts for Classroom grade sync.
