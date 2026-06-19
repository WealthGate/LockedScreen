import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";

import { build } from "esbuild";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const bundleDirectory = await mkdtemp(join(tmpdir(), "lockedscreen-report-tests-"));
const bundlePath = join(bundleDirectory, "student-performance-report.mjs");

await build({
  entryPoints: [resolve(testDirectory, "../src/main/student-performance-report.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile: bundlePath,
  logLevel: "silent"
});

const { buildStudentPerformanceReport, richContentToPlainText } = await import(pathToFileURL(bundlePath).href);

after(async () => {
  await rm(bundleDirectory, { recursive: true, force: true });
});

const exam = {
  id: "exam-1",
  mode: "app",
  title: "Mathematics Check",
  subject: "Mathematics",
  className: "Grade 8",
  form: "A",
  instructions: "Answer every question.",
  durationMinutes: 30,
  branding: { schoolName: "Northfield Academy", accentColor: "#0f766e" },
  appearance: { theme: "light", headerLayout: "centered", fontScale: 1, density: "comfortable" },
  questions: [
    {
      id: "q1",
      type: "multiple-choice",
      prompt: "What is 2<sup>2</sup>?",
      points: 2,
      options: [
        { id: "a", label: "A", content: "3" },
        { id: "b", label: "B", content: "4" }
      ],
      correctOptionId: "b"
    },
    {
      id: "q2",
      type: "multiple-choice",
      prompt: "Choose H<sub>2</sub>O.",
      points: 1,
      options: [
        { id: "a", label: "A", content: "Water" },
        { id: "b", label: "B", content: "Salt" }
      ],
      correctOptionId: "a"
    }
  ],
  createdAt: "2026-06-19T10:00:00.000Z",
  updatedAt: "2026-06-19T10:00:00.000Z"
};

const submission = {
  id: "submission-1",
  examId: exam.id,
  examTitle: exam.title,
  candidateName: "Ada Student",
  candidateId: "STU-100",
  candidateClassName: "Grade 8A",
  submittedAt: "2026-06-19T10:30:00.000Z",
  score: 2,
  totalPoints: 3,
  percentage: 66.67,
  responses: [
    { questionId: "q1", selectedOptionId: "b", flagged: false },
    { questionId: "q2", selectedOptionId: "b", flagged: false }
  ],
  syncStates: []
};

test("builds a readable student performance report", () => {
  const report = buildStudentPerformanceReport(exam, submission);

  assert.match(report.plainText, /LOCKEDSCREEN PERFORMANCE REPORT/);
  assert.match(report.plainText, /Ada Student/);
  assert.match(report.plainText, /Score: 2 \/ 3/);
  assert.match(report.plainText, /Percentage: 66\.67%/);
  assert.match(report.plainText, /What is 2\^2\?/);
  assert.match(report.plainText, /Your answer: B\. 4/);
  assert.equal(report.questions[0]?.result, "Correct");
  assert.equal(report.questions[1]?.result, "Incorrect");
  assert.match(report.html, /Question review/);
  assert.doesNotMatch(report.html, /\{\s*"exam"/);
});

test("removes executable markup and safely handles invalid entities", () => {
  const text = richContentToPlainText(
    '<script>window.evil = true</script><style>body{display:none}</style><p>Safe &amp; clear &#99999999;</p>'
  );

  assert.equal(text, "Safe & clear");
  assert.doesNotMatch(text, /window\.evil|display:none/);
});
