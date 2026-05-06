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
10. The endpoint writes the row to the Sheet and sorts by student last name.

Students do not enter the Google Sheet link or endpoint URL on their devices.

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

## Minimal Apps Script Example

Deploy this as a Google Apps Script web app with access to the teacher/school Google account that owns the Sheet.

```javascript
function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const spreadsheetId = body.destination.sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)[1];
  const sheetName = body.destination.sheetName || "Sheet1";
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Last Name",
      "First Name",
      "Student Name",
      "Candidate ID",
      "Class",
      "Exam",
      "Subject",
      "Score",
      "Total",
      "Percentage",
      "Submitted At"
    ]);
  }

  sheet.appendRow([
    body.student.lastName,
    body.student.firstName,
    body.student.name,
    body.student.candidateId,
    body.student.className,
    body.exam.title,
    body.exam.subject,
    body.grade.score,
    body.grade.totalPoints,
    body.grade.percentage,
    body.grade.submittedAt
  ]);

  if (body.destination.sortByLastName !== false && sheet.getLastRow() > 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).sort([
      { column: 1, ascending: true },
      { column: 2, ascending: true }
    ]);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ referenceId: sheet.getName() + "!" + sheet.getLastRow() }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

For production, protect the endpoint with a school-issued token or domain restriction before using it for live exams.
