import assert from "node:assert/strict";
import test from "node:test";

import type { StudentLmsBinding, SubmissionResult } from "@lockedscreen/shared-types";

import { syncGoogleClassroomGrade } from "./google-classroom-grade-sync";

const binding: StudentLmsBinding = {
  enabled: true,
  provider: "google-classroom",
  clientId: "client-id",
  scope: "",
  courseId: "course-1",
  assignmentId: "work-1"
};

const submission: SubmissionResult = {
  id: "submission-1",
  examId: "exam-1",
  examTitle: "Chemistry",
  candidateId: "student-1",
  candidateName: "Student One",
  candidateClassName: "Class 1",
  submittedAt: "2026-06-15T00:00:00.000Z",
  score: 8,
  totalPoints: 10,
  percentage: 80,
  responses: [],
  syncStates: []
};

test("syncs the Classroom grade directly when the student submission id is accepted", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ url: String(input), init });
    const body = requests.length === 1 ? { maxPoints: 20 } : { id: "student-submission-1" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await syncGoogleClassroomGrade(
      binding,
      {
        teacherAccessToken: "teacher-token",
        studentSubmissionId: "student-submission-1",
        studentEmail: "student@example.edu"
      },
      submission
    );

    assert.equal(result.gradeSyncStatus, "success");
    assert.equal(result.gradeValue, 16);
    assert.equal(requests.length, 2);
    assert.match(requests[1]?.url ?? "", /studentSubmissions\/student-submission-1\?updateMask=assignedGrade,draftGrade/);
    assert.deepEqual(JSON.parse(String(requests[1]?.init.body)), { assignedGrade: 16, draftGrade: 16 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back to the teacher-visible submission found by student email after a Classroom not-found response", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    requests.push({ url: String(input), init });
    if (requests.length === 1) {
      return new Response(JSON.stringify({ maxPoints: 10 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (requests.length === 2) {
      return new Response(JSON.stringify({ error: { message: "Requested entity was not found." } }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    }
    if (requests.length === 3) {
      return new Response(JSON.stringify({ studentSubmissions: [{ id: "teacher-visible-submission" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ id: "teacher-visible-submission" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const result = await syncGoogleClassroomGrade(
      binding,
      {
        teacherAccessToken: "teacher-token",
        studentSubmissionId: "student-token-submission",
        studentEmail: "student@example.edu"
      },
      submission
    );

    assert.equal(result.gradeSyncStatus, "success");
    assert.equal(requests.length, 4);
    assert.match(requests[2]?.url ?? "", /studentSubmissions\?userId=student%40example\.edu&pageSize=1/);
    assert.match(requests[3]?.url ?? "", /studentSubmissions\/teacher-visible-submission\?updateMask=assignedGrade,draftGrade/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns an actionable grade-sync message instead of Google's raw requested-entity text", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: "Requested entity was not found." } }), {
      status: 404,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

  try {
    const result = await syncGoogleClassroomGrade(
      binding,
      {
        teacherAccessToken: "teacher-token",
        studentSubmissionId: "missing-submission",
        studentEmail: "student@example.edu"
      },
      submission
    );

    assert.equal(result.gradeSyncStatus, "failed");
    assert.match(result.gradeSyncError ?? "", /connected teacher account is a teacher/);
    assert.doesNotMatch(result.gradeSyncError ?? "", /Requested entity was not found/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
