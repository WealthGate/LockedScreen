import assert from "node:assert/strict";
import test from "node:test";

import type { GoogleIntegrationSettings } from "@lockedscreen/shared-types";

import { GoogleClassroomService } from "./google-classroom-service";
import type { GoogleOAuthFlow } from "./google-oauth-service";

const settings: GoogleIntegrationSettings = {
  enabled: true,
  clientId: "client-id",
  clientSecret: "client-secret",
  requestedScopes: [
    "https://www.googleapis.com/auth/classroom.coursework.students",
    "https://www.googleapis.com/auth/drive.file"
  ],
  connectionStatus: "connected"
};

test("finalizes the package with the assignment id before publishing Classroom work", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const responses = [
    { id: "drive-1", name: "Exam.lscp", webViewLink: "https://drive.test/drive-1" },
    { id: "work-1", courseId: "course-1", title: "Biology Exam", state: "DRAFT" },
    { id: "drive-1", name: "Exam.lscp", webViewLink: "https://drive.test/drive-1" },
    {
      id: "work-1",
      courseId: "course-1",
      title: "Biology Exam",
      state: "PUBLISHED",
      alternateLink: "https://classroom.test/work-1"
    }
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ url: String(input), init });
    const body = responses.shift();
    assert.ok(body, "Unexpected Google API request");
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  const oauth: GoogleOAuthFlow = {
    beginTeacherSignIn: async () => {
      throw new Error("Not used in this test");
    },
    getAccessToken: async () => "teacher-token",
    signOut: async () => undefined
  };

  try {
    const service = new GoogleClassroomService(oauth);
    const result = await service.publishPackageCourseWork("connection-1", settings, {
      courseId: "course-1",
      title: "Biology Exam",
      description: "Open in Lockedscreen.",
      fileName: "Exam.lscp",
      initialPackageJson: JSON.stringify({ assignmentId: "" }),
      buildFinalPackageJson: (courseWork) => JSON.stringify({ assignmentId: courseWork.id }),
      maxPoints: 20
    });

    assert.equal(result.courseWork.id, "work-1");
    assert.equal(result.courseWork.state, "PUBLISHED");
    assert.equal(requests.length, 4);

    const createBody = JSON.parse(String(requests[1]?.init.body)) as Record<string, unknown>;
    assert.equal(createBody.state, "DRAFT");

    assert.match(requests[2]?.url ?? "", /files\/drive-1\?uploadType=media/);
    assert.equal(requests[2]?.init.method, "PATCH");
    assert.deepEqual(JSON.parse(String(requests[2]?.init.body)), { assignmentId: "work-1" });

    assert.match(requests[3]?.url ?? "", /courseWork\/work-1\?updateMask=state/);
    assert.equal(requests[3]?.init.method, "PATCH");
    assert.deepEqual(JSON.parse(String(requests[3]?.init.body)), { state: "PUBLISHED" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
