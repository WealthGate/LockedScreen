import assert from "node:assert/strict";
import test from "node:test";

import { buildGoogleClassroomStudentSubmissionActionUrl } from "./student-lms-url";

const courseWorkBaseUrl =
  "https://classroom.googleapis.com/v1/courses/course-1/courseWork/work-1";

test("builds Google Classroom student submission action URLs with gRPC action syntax", () => {
  assert.equal(
    buildGoogleClassroomStudentSubmissionActionUrl(
      courseWorkBaseUrl,
      "submission/1",
      "modifyAttachments"
    ),
    `${courseWorkBaseUrl}/studentSubmissions/submission%2F1:modifyAttachments`
  );
  assert.equal(
    buildGoogleClassroomStudentSubmissionActionUrl(courseWorkBaseUrl, "submission-1", "turnIn"),
    `${courseWorkBaseUrl}/studentSubmissions/submission-1:turnIn`
  );
});
