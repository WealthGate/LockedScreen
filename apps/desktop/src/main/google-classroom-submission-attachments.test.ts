import assert from "node:assert/strict";
import test from "node:test";

import {
  attachGoogleClassroomSubmissionArtifact,
  buildGoogleClassroomDriveFileAttachmentRequest
} from "./google-classroom-submission-attachments";

const uploadedFile = {
  id: "drive-file-1",
  name: "student-result.json",
  webViewLink: "https://drive.google.com/file/d/drive-file-1/view"
};

test("builds a Classroom Drive attachment request with only the writable file id", () => {
  assert.deepEqual(buildGoogleClassroomDriveFileAttachmentRequest(uploadedFile), {
    addAttachments: [
      {
        driveFile: {
          id: "drive-file-1"
        }
      }
    ]
  });
});

test("attaches the uploaded Drive file to the student submission", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "submission-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const warning = await attachGoogleClassroomSubmissionArtifact(
      "https://classroom.googleapis.com/v1/courses/course-1/courseWork/work-1",
      "submission-1",
      "student-token",
      uploadedFile
    );

    assert.equal(warning, undefined);
    assert.equal(requests.length, 1);
    assert.match(requests[0]?.url ?? "", /studentSubmissions\/submission-1:modifyAttachments/);
    assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), {
      addAttachments: [
        {
          driveFile: {
            id: "drive-file-1"
          }
        }
      ]
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back to a link attachment if Classroom rejects the Drive file attachment", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ url: String(input), init });
    if (requests.length === 1) {
      return new Response(JSON.stringify({ error: { message: "addAttachments[0].driveFile was rejected." } }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ id: "submission-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const warning = await attachGoogleClassroomSubmissionArtifact(
      "https://classroom.googleapis.com/v1/courses/course-1/courseWork/work-1",
      "submission-1",
      "student-token",
      uploadedFile
    );

    assert.equal(warning, undefined);
    assert.equal(requests.length, 2);
    assert.deepEqual(JSON.parse(String(requests[1]?.init.body)), {
      addAttachments: [
        {
          link: {
            url: "https://drive.google.com/file/d/drive-file-1/view"
          }
        }
      ]
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns a warning instead of throwing when Classroom rejects every attachment attempt", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: "addAttachments could not be modified." } }), {
      status: 400,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

  try {
    const warning = await attachGoogleClassroomSubmissionArtifact(
      "https://classroom.googleapis.com/v1/courses/course-1/courseWork/work-1",
      "submission-1",
      "student-token",
      uploadedFile
    );

    assert.match(warning ?? "", /did not accept the Lockedscreen result file attachment/);
    assert.match(warning ?? "", /addAttachments could not be modified/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
