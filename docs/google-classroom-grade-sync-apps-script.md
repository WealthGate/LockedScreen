# Google Classroom Grade Sync Apps Script

Use this script for the `Google Classroom grade sync server` destination in Lockedscreen.

Do not use the Google Sheets sync script for Classroom grade passback. The Sheets script writes rows to a spreadsheet only. This Classroom script receives a Lockedscreen score and writes `draftGrade` and `assignedGrade` to the matching Google Classroom student submission.

## What URL to Paste in Lockedscreen

After deploying this Apps Script as a Web app, copy the deployed URL ending in `/exec`.

Paste that URL into:

`Admin Console > Grade sync > Grade-sync server URL`

The URL normally looks like this:

```text
https://script.google.com/macros/s/AKfycb.../exec
```

## Required Setup

1. The package must be connected to a Google Classroom class and assignment.
2. The Apps Script must run as a teacher/admin account that can grade that Classroom assignment.
3. Best matching happens when students use Lockedscreen student turn-in, because Lockedscreen can carry the Classroom student submission reference.
4. If student turn-in is not used, set the student's Candidate ID to their Google Classroom email address so the script can look up their submission by email.

## Code.gs

```javascript
function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return jsonResponse({ message: "Missing Lockedscreen grade-sync payload." }, 400);
  }

  const body = JSON.parse(e.postData.contents);
  if (body.schema !== "lockedscreen.google-classroom.grade-sync.v1") {
    return jsonResponse({ message: "Unsupported payload schema." }, 400);
  }

  const courseId = String(body.classroom && body.classroom.courseId || "").trim();
  const courseWorkId = String(
    body.classroom && (body.classroom.courseWorkId || body.classroom.assignmentId) || ""
  ).trim();
  if (!courseId || !courseWorkId) {
    return jsonResponse({ message: "Missing Google Classroom course or assignment ID." }, 400);
  }

  const grade = readGrade(body);
  const submissionId = resolveStudentSubmissionId(courseId, courseWorkId, body);
  const classroomGrade = scaleGradeToClassroom(courseId, courseWorkId, grade);
  const updated = updateClassroomGrade(courseId, courseWorkId, submissionId, classroomGrade);

  return jsonResponse({
    referenceId: courseId + "/" + courseWorkId + "/" + submissionId,
    classroomGrade: classroomGrade,
    updated: updated
  }, 200);
}

function readGrade(body) {
  const score = Number(body.grade && body.grade.score);
  const totalPoints = Number(body.grade && body.grade.totalPoints);
  if (!Number.isFinite(score) || !Number.isFinite(totalPoints) || totalPoints <= 0) {
    throw new Error("Invalid Lockedscreen grade values.");
  }

  return {
    score: score,
    totalPoints: totalPoints
  };
}

function resolveStudentSubmissionId(courseId, courseWorkId, body) {
  const directId = parseSubmissionReference(body.classroom && body.classroom.studentSubmissionId);
  if (directId) {
    return directId;
  }

  const candidateId = String(body.student && body.student.candidateId || "").trim();
  if (candidateId && candidateId.indexOf("@") !== -1) {
    return findSubmissionByUser(courseId, courseWorkId, candidateId);
  }

  throw new Error(
    "No Classroom student submission reference found. Use Student turn-in, or set Candidate ID to the student's Google Classroom email address."
  );
}

function parseSubmissionReference(value) {
  const reference = String(value || "").trim();
  if (!reference) {
    return "";
  }

  const parts = reference.split("/").filter(Boolean);
  return parts.length >= 3 ? parts[2] : reference;
}

function findSubmissionByUser(courseId, courseWorkId, userId) {
  const url =
    "https://classroom.googleapis.com/v1/courses/" +
    encodeURIComponent(courseId) +
    "/courseWork/" +
    encodeURIComponent(courseWorkId) +
    "/studentSubmissions?userId=" +
    encodeURIComponent(userId) +
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
    throw new Error("No Classroom submission found for " + userId + ".");
  }

  return body.studentSubmissions[0].id;
}

function scaleGradeToClassroom(courseId, courseWorkId, grade) {
  const maxPoints = readClassroomMaxPoints(courseId, courseWorkId) || grade.totalPoints;
  return Math.round((grade.score / grade.totalPoints) * maxPoints * 100) / 100;
}

function readClassroomMaxPoints(courseId, courseWorkId) {
  const url =
    "https://classroom.googleapis.com/v1/courses/" +
    encodeURIComponent(courseId) +
    "/courseWork/" +
    encodeURIComponent(courseWorkId);

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

function updateClassroomGrade(courseId, courseWorkId, submissionId, classroomGrade) {
  const url =
    "https://classroom.googleapis.com/v1/courses/" +
    encodeURIComponent(courseId) +
    "/courseWork/" +
    encodeURIComponent(courseWorkId) +
    "/studentSubmissions/" +
    encodeURIComponent(submissionId) +
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

  return JSON.parse(response.getContentText() || "{}");
}

function jsonResponse(value, status) {
  return ContentService
    .createTextOutput(JSON.stringify(Object.assign({ status: status || 200 }, value)))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## appsscript.json

Enable the manifest file in Apps Script project settings, then use:

```json
{
  "timeZone": "America/Dominica",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/classroom.coursework.students"
  ]
}
```

## Deploy

1. Click `Deploy > New deployment`.
2. Choose `Web app`.
3. Set `Execute as` to `Me`.
4. Set access to the broadest option allowed by the school policy.
5. Deploy and approve the Classroom permission.
6. Copy the Web app URL ending in `/exec`.
7. Paste it into Lockedscreen `Grade-sync server URL`.

For production use, a school-owned server with API-key or bearer-token validation is stronger than a public Apps Script URL.
