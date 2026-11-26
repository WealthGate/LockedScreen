import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: [
    'export * from "./packages/exam-engine/src/shared-media";',
    'export * from "./packages/exam-engine/src/reading-passages";',
    'export * from "./apps/desktop/src/renderer/lib/question-ranges";',
    'export * from "./apps/desktop/src/main/security/package-crypto";',
    'export {createStorageService} from "./packages/storage/src/index";'
  ].join("\n"), resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", write: false,
  alias: { "@lockedscreen/storage": "./packages/storage/src/index.ts", "@lockedscreen/exam-engine": "./packages/exam-engine/src/index.ts" }
});
const { parseQuestionRange, formatQuestionRange, isSharedMediaList, isReadingPassageList, importPassages, removeQuestionAssignment, duplicateQuestionAssignment, createStorageService, protectConfigPackage, unprotectConfigPackage } =
  await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].contents).toString("base64"));

test("assigns ranges inclusively by question ID and describes the current order", () => {
  const questions = Array.from({ length: 12 }, (_, i) => ({ id: "q" + (i + 1) }));
  const ids = parseQuestionRange("1 - 10, 7–8, 12", questions);
  assert.deepEqual(ids, questions.filter(q => q.id !== "q11").map(q => q.id));
  assert.equal(formatQuestionRange(ids, questions), "1–10, 12");
  assert.equal(formatQuestionRange(ids, [...questions].reverse()), "1, 3–12");
  for (const invalid of ["", "0", "11-13", "5-2", "1.5", "1,", "x", "9999999999999"]) {
    assert.throws(() => parseQuestionRange(invalid, questions));
  }
});

test("accepts legacy exams and only embedded supported media with unique file IDs", () => {
  assert.equal(isSharedMediaList(undefined), true);
  const clip = { id: "1", name: "Speech", questionIds: ["q1"], dataUrl: "data:audio/mpeg;base64,AQ==" };
  assert.equal(isSharedMediaList([clip]), true);
  for (const dataUrl of ["https://example.edu/clip.mp3", "data:text/html;base64,AQ==", "data:image/svg+xml;base64,AQ==", "data:video/mp4;base64,"]) {
    assert.equal(isSharedMediaList([{ ...clip, dataUrl }]), false);
  }
  for (const invalid of [null, {}, [null], [clip, clip], [{ ...clip, questionIds: "q1" }]]) {
    assert.equal(isSharedMediaList(invalid), false);
  }
});

test("shared passages and attachments survive teacher save, protected export and student reopen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lockedscreen-media-"));
  try {
    const teacher = createStorageService(join(dir, "teacher"));
    const initial = await teacher.getSnapshot();
    const exam = initial.exams.find(exam => exam.questions.length >= 2);
    const questionIds = exam.questions.slice(0, 2).map(question => question.id);
    const sharedMedia = ["audio/wav", "image/png", "video/webm"].map((mime, index) => ({
      id: String(index), name: mime, questionIds, dataUrl: "data:" + mime + ";base64,AQID"
    }));
    const passages = [{ id: "reading", title: "Harbour", text: "Low tide.\n\nHigh tide.", questionIds }];
    await teacher.saveExam({ ...exam, sharedMedia, passages });
    const reopened = await createStorageService(join(dir, "teacher")).getSnapshot();
    const saved = reopened.exams.find(item => item.id === exam.id);
    const config = reopened.configPackages.find(item => item.examId === exam.id);
    const file = JSON.parse(JSON.stringify(protectConfigPackage(config, "fixture", saved)));
    const opened = unprotectConfigPackage(file, "fixture");
    const student = createStorageService(join(dir, "student"));
    await student.importExamBundle(opened.exam, opened.configPackage);
    const workspace = await createStorageService(join(dir, "student")).getSnapshot();
    const imported = workspace.exams.find(item => item.id === workspace.configPackages.find(p=>p.id===config.id).examId);
    assert.deepEqual(imported.sharedMedia, sharedMedia);
    assert.deepEqual(imported.passages, passages);
    assert.deepEqual(imported.questions, exam.questions);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("new imports, duplicates and deletions keep passages on the intended questions", () => {
  const p = { id: "p", title: "Title", text: "First paragraph\n\nSecond paragraph.", questionIds: ["q2"] };
  const questions = [{ id: "q1" }, { id: "q2" }];
  assert.equal(isReadingPassageList(undefined, questions), true);
  assert.equal(isReadingPassageList([p], questions), true);
  for (const bad of [[p, p], [{ ...p, text: " " }], [{ ...p, questionIds: [] }], [{ ...p, questionIds: ["missing"] }], [null]]) {
    assert.equal(isReadingPassageList(bad, questions), false);
  }
  const copied = duplicateQuestionAssignment([p], "q2", "q3");
  assert.deepEqual(copied[0].questionIds, ["q2","q3"]);
  assert.deepEqual(removeQuestionAssignment(copied, "q2")[0].questionIds, ["q3"]);
  assert.deepEqual(removeQuestionAssignment([p], "q2"), []);
  const mapped = importPassages([p], new Map([["q2","fresh"]]));
  assert.notEqual(mapped[0].id,p.id);
  assert.deepEqual(mapped[0].questionIds,["fresh"]);
  assert.throws(() => importPassages([p], new Map()));
});
