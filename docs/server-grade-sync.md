# Server-side Google Classroom grade sync

Lockedscreen does not put teacher OAuth refresh tokens inside exported student packages. That is intentional: exported packages can move to student machines, so teacher-grade-write authority must stay on a trusted school-owned service.

## Architecture

1. A teacher signs in to Google Classroom on the admin/teacher install and selects the class and assignment for a package.
2. Students complete the Lockedscreen assessment locally.
3. Lockedscreen posts the completed score to a configured `Google Classroom grade sync server` result destination.
4. The school-owned server validates the request, maps the package/class/assignment to the Classroom coursework, and writes the grade using server-side Google authorization.

## Desktop payload

The desktop app sends JSON with schema `lockedscreen.google-classroom.grade-sync.v1`.

Important fields:

- `classroom.courseId`: Google Classroom course id or the configured class reference.
- `classroom.courseWorkId`: Lockedscreen exam/package reference for the server to map to Classroom coursework.
- `classroom.studentSubmissionId`: Classroom student submission reference when available.
- `student.candidateId`: student id captured by Lockedscreen.
- `grade.score`, `grade.totalPoints`, `grade.percentage`: local grading result.
- `submission.responses`: included only when the destination enables per-question responses.

## Security expectations

- Use HTTPS.
- Use a per-school API key or bearer token in the destination configuration.
- Validate request signatures or tokens on the server.
- Store Google refresh tokens only on the server, encrypted with the server platform's secret store.
- Keep a server-side audit log of every Classroom grade write.

The desktop app supports the bridge contract; the production server still needs deployment with the school's Google authorization policy and Classroom write permissions.
