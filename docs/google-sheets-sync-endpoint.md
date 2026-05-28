# Google Sheets Sync Endpoint

Lockedscreen does not put teacher Google tokens inside exported student exam packages. The exported `.lscp` package can safely contain a Google Sheet link and a sync URL, but the actual Google Sheets write must happen on a school-controlled endpoint.

## Practical Setup

1. School admin deploys one Google Apps Script web app or school API endpoint.
2. Admin opens Lockedscreen Admin Console > Google Classroom > Advanced admin Google setup.
3. Admin enters the endpoint in `Default Google Sheets sync URL`.
4. Teacher creates or opens the destination Google Sheet.
5. Teacher prepares the test and creates a Google Sheets grade destination.
6. Teacher pastes the Google Sheet link once.
7. Teacher exports or posts the test package.
8. Students open the exported package on their own machines.
9. On submission, the app sends the grade to the endpoint from the package.
10. The endpoint creates headings automatically, writes the grade, and sorts by student last name.

Students do not enter the Google Sheet link or endpoint URL on their devices.
Teachers do not need to create headings. The script creates fixed student identity columns and creates new exam result columns as new tests arrive.

## Using Google Sheets and Google Classroom Together

Google Sheets and Google Classroom are separate result destinations in Lockedscreen. A teacher can use both for the same test:

1. Create a `Google Sheets` destination and paste the teacher's Sheet link.
2. Create a `Google Classroom grade sync server` destination and select the same exam scope.
3. Set both destinations to `Auto sync after submission`.
4. Keep both destinations enabled before exporting or posting the package.

When a student submits, Lockedscreen stores the local result first, then sends the score to every enabled auto-sync destination for that exam. This lets the school keep a spreadsheet gradebook while also writing the grade back to Google Classroom.

## Getting the Apps Script Web App URL

Use this option when the school wants Google Sheets grade rows without running its own server.

1. Open [Google Apps Script](https://script.google.com/).
2. Click `New project`.
3. Paste the script in the `Gradebook Apps Script Example` section below into `Code.gs`.
4. Click `Save`.
5. Click `Deploy > New deployment`.
6. Next to `Select type`, choose `Web app`.
7. Set `Execute as` to `Me`.
8. Set access to `Anyone` or the broadest option allowed by the school Google Workspace policy.
9. Click `Deploy` and approve the requested Google Sheets permissions.
10. Copy the deployed web app URL. It normally looks like `https://script.google.com/macros/s/.../exec`.
11. Paste that URL into Lockedscreen `Admin Console > Google Classroom > Advanced admin Google setup > Default Google Sheets sync URL`, then save settings.

Do not test the script by clicking `Run` inside the Apps Script editor. `doPost(e)` receives `e.postData` only when Lockedscreen or another HTTP client sends a POST request to the deployed web app URL.

Google's Apps Script documentation states that web apps need a `doGet(e)` or `doPost(e)` function and are deployed from `Deploy > New deployment > Web app`: https://developers.google.com/apps-script/guides/web

## Expected Payload

The endpoint receives JSON shaped like this:

```json
{
  "schema": "lockedscreen.google-sheets.grade-row.v1",
  "requestedAction": "append-grade-row",
  "destination": {
    "sheetUrl": "https://docs.google.com/spreadsheets/d/...",
    "sheetName": "Sheet1",
    "sortByLastName": true
  },
  "student": {
    "name": "Ada Lovelace",
    "firstName": "Ada",
    "lastName": "Lovelace",
    "candidateId": "STU-001",
    "className": "Grade 10"
  },
  "exam": {
    "title": "Mathematics Test",
    "subject": "Mathematics"
  },
  "grade": {
    "score": 18,
    "totalPoints": 20,
    "percentage": 90,
    "submittedAt": "2026-05-05T12:00:00.000Z"
  }
}
```

## Gradebook Apps Script Example

Deploy this as a Google Apps Script web app with access to the teacher/school Google account that owns the Sheet.
It keeps one row per student. If the same student takes another test in the same Sheet, the script adds new columns for that exam instead of adding a duplicate student row.

```javascript
function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const match = body.destination.sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match || !match[1]) {
    return jsonResponse({ message: "Invalid Google Sheet URL." });
  }

  const spreadsheetId = match[1];
  const sheetName = body.destination.sheetName || "Sheet1";
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);

  const identityHeaders = ["Last Name", "First Name", "Student Name", "Candidate ID", "Class"];
  ensureHeaders(sheet, identityHeaders);

  const examLabel = safeHeader(body.exam.title || "Untitled Exam");
  const examHeaders = [
    examLabel + " Score",
    examLabel + " Total",
    examLabel + " Percentage",
    examLabel + " Submitted At"
  ];
  const headerMap = ensureHeaders(sheet, identityHeaders.concat(examHeaders));
  const studentRow = findOrCreateStudentRow(sheet, body, headerMap);

  sheet.getRange(studentRow, headerMap[examHeaders[0]]).setValue(body.grade.score);
  sheet.getRange(studentRow, headerMap[examHeaders[1]]).setValue(body.grade.totalPoints);
  sheet.getRange(studentRow, headerMap[examHeaders[2]]).setValue(body.grade.percentage);
  sheet.getRange(studentRow, headerMap[examHeaders[3]]).setValue(body.grade.submittedAt);

  if (body.destination.sortByLastName !== false && sheet.getLastRow() > 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).sort([
      { column: headerMap["Last Name"], ascending: true },
      { column: headerMap["First Name"], ascending: true }
    ]);
  }

  return jsonResponse({ referenceId: sheet.getName() + "!" + studentRow });
}

function ensureHeaders(sheet, requiredHeaders) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(requiredHeaders);
  }

  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  requiredHeaders.forEach(function (header) {
    if (currentHeaders.indexOf(header) === -1) {
      currentHeaders.push(header);
      sheet.getRange(1, currentHeaders.length).setValue(header);
    }
  });

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.reduce(function (map, header, index) {
    map[header] = index + 1;
    return map;
  }, {});
}

function findOrCreateStudentRow(sheet, body, headerMap) {
  const lastRow = sheet.getLastRow();
  const candidateId = String(body.student.candidateId || "").trim();
  const studentName = String(body.student.name || "").trim();

  if (lastRow > 1) {
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    for (let index = 0; index < values.length; index++) {
      const row = values[index];
      const rowCandidateId = String(row[headerMap["Candidate ID"] - 1] || "").trim();
      const rowStudentName = String(row[headerMap["Student Name"] - 1] || "").trim();
      if ((candidateId && rowCandidateId === candidateId) || (!candidateId && rowStudentName === studentName)) {
        return index + 2;
      }
    }
  }

  const nextRow = sheet.getLastRow() + 1;
  sheet.getRange(nextRow, headerMap["Last Name"]).setValue(body.student.lastName || "");
  sheet.getRange(nextRow, headerMap["First Name"]).setValue(body.student.firstName || "");
  sheet.getRange(nextRow, headerMap["Student Name"]).setValue(body.student.name || "");
  sheet.getRange(nextRow, headerMap["Candidate ID"]).setValue(body.student.candidateId || "");
  sheet.getRange(nextRow, headerMap["Class"]).setValue(body.student.className || "");
  return nextRow;
}

function safeHeader(value) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled Exam";
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
```

For production, protect the endpoint with a school-issued token or domain restriction before using it for live exams.
