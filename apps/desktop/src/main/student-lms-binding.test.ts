import assert from "node:assert/strict";
import test from "node:test";

import type { LmsCourseWork } from "@lockedscreen/shared-types";

import { selectMatchingCourseWork } from "./student-lms-binding";

const courseWork = (id: string, title: string): LmsCourseWork => ({
  id,
  courseId: "course-1",
  title,
  state: "PUBLISHED"
});

test("recovers one assignment whose normalized title matches the exam", () => {
  const match = selectMatchingCourseWork(
    [courseWork("work-1", "Biology   Exam"), courseWork("work-2", "Chemistry Exam")],
    [" biology exam "]
  );

  assert.equal(match?.id, "work-1");
});

test("does not guess when multiple assignments have the same title", () => {
  const match = selectMatchingCourseWork(
    [courseWork("work-1", "Biology Exam"), courseWork("work-2", "Biology Exam")],
    ["Biology Exam"]
  );

  assert.equal(match, null);
});
