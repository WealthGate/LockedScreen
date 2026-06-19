import type { Exam, SubmissionResult } from "@lockedscreen/shared-types";

export interface StudentPerformanceQuestion {
  number: number;
  prompt: string;
  selectedAnswer: string;
  result: "Correct" | "Incorrect" | "Not answered";
  pointsAwarded: number;
  pointsAvailable: number;
}

export interface StudentPerformanceReport {
  title: string;
  plainText: string;
  html: string;
  questions: StudentPerformanceQuestion[];
}

const decodeCodePoint = (code: string, radix: number): string => {
  const value = Number.parseInt(code, radix);
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
};

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => decodeCodePoint(code, 16))
    .replace(/&#([0-9]+);/g, (_match, code: string) => decodeCodePoint(code, 10))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");

export const richContentToPlainText = (value: string): string => {
  const withoutExecutableContent = value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const withReadableFormatting = withoutExecutableContent
    .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, "^$1")
    .replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, "_$1")
    .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1");
  const withImageLabels = withReadableFormatting.replace(
    /<img\b[^>]*\balt\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi,
    (_match, doubleQuoted: string | undefined, singleQuoted: string | undefined) =>
      ` [Image: ${doubleQuoted || singleQuoted || "question image"}] `
  );
  const withLineBreaks = withImageLabels
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(?:div|h[1-6]|li|p|tr)>/gi, "\n");
  const withoutTags = withLineBreaks.replace(/<[^>]*>/g, " ");
  return decodeHtmlEntities(withoutTags)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
};

const inlineText = (value: string): string => richContentToPlainText(value).replace(/\s*\n\s*/g, " ");

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatNumber = (value: number): string =>
  Number.isFinite(value) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value) : "0";

const formatDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
};

const buildQuestionReview = (exam: Exam, submission: SubmissionResult): StudentPerformanceQuestion[] => {
  const responseLookup = new Map(submission.responses.map((response) => [response.questionId, response]));

  return exam.questions.map((question, index) => {
    const response = responseLookup.get(question.id);
    const selectedOption = question.options.find((option) => option.id === response?.selectedOptionId);
    const answered = Boolean(selectedOption);
    const correct = answered && selectedOption?.id === question.correctOptionId;
    const selectedContent = selectedOption ? inlineText(selectedOption.content) : "No answer selected";

    return {
      number: index + 1,
      prompt: inlineText(question.prompt) || `Question ${index + 1}`,
      selectedAnswer: selectedOption
        ? `${selectedOption.label ? `${selectedOption.label}. ` : ""}${selectedContent}`.trim()
        : selectedContent,
      result: correct ? "Correct" : answered ? "Incorrect" : "Not answered",
      pointsAwarded: correct ? question.points : 0,
      pointsAvailable: question.points
    };
  });
};

export const buildStudentPerformanceReport = (exam: Exam, submission: SubmissionResult): StudentPerformanceReport => {
  const questions = buildQuestionReview(exam, submission);
  const title = `${exam.title || submission.examTitle || "Exam"} - Performance Report`;
  const studentClass = submission.candidateClassName || exam.className || exam.form || "Not provided";
  const score = `${formatNumber(submission.score)} / ${formatNumber(submission.totalPoints)}`;
  const percentage = `${formatNumber(submission.percentage)}%`;
  const questionText =
    questions.length > 0
      ? questions
          .map(
            (question) =>
              [
                `${question.number}. ${question.prompt}`,
                `   Your answer: ${question.selectedAnswer}`,
                `   Result: ${question.result}`,
                `   Points: ${formatNumber(question.pointsAwarded)} / ${formatNumber(question.pointsAvailable)}`
              ].join("\n")
          )
          .join("\n\n")
      : "No in-app question review is available for this linked exam.";

  const plainText = [
    "LOCKEDSCREEN PERFORMANCE REPORT",
    "",
    title,
    "",
    `Student: ${submission.candidateName}`,
    `Student ID: ${submission.candidateId}`,
    `Class: ${studentClass}`,
    `Subject: ${exam.subject || "Not provided"}`,
    `Submitted: ${formatDate(submission.submittedAt)}`,
    "",
    "SCORE SUMMARY",
    `Score: ${score}`,
    `Percentage: ${percentage}`,
    "",
    "QUESTION REVIEW",
    questionText,
    "",
    `Report generated by Lockedscreen for submission ${submission.id}.`
  ].join("\n");

  const questionHtml =
    questions.length > 0
      ? questions
          .map((question) => {
            const resultClass =
              question.result === "Correct" ? "correct" : question.result === "Incorrect" ? "incorrect" : "unanswered";
            return `
              <section class="question">
                <div class="question-heading">
                  <span>Question ${question.number}</span>
                  <span class="result ${resultClass}">${escapeHtml(question.result)}</span>
                </div>
                <div class="prompt">${escapeHtml(question.prompt)}</div>
                <div class="answer"><strong>Your answer:</strong> ${escapeHtml(question.selectedAnswer)}</div>
                <div class="points">Points: ${formatNumber(question.pointsAwarded)} / ${formatNumber(question.pointsAvailable)}</div>
              </section>`;
          })
          .join("")
      : '<section class="question"><div class="prompt">No in-app question review is available for this linked exam.</div></section>';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #172033; font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.45; }
      header { border-bottom: 3px solid #0f766e; padding-bottom: 14px; }
      .brand { color: #0f766e; font-size: 10pt; font-weight: 700; letter-spacing: 0; text-transform: uppercase; }
      h1 { margin: 5px 0 0; font-size: 22pt; line-height: 1.2; }
      .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 20px; margin: 18px 0; }
      .meta-item { border-bottom: 1px solid #d9e1e8; padding-bottom: 5px; }
      .meta-label { color: #52606d; display: block; font-size: 8pt; font-weight: 700; text-transform: uppercase; }
      .score { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0 20px; }
      .score-item { border: 1px solid #99d5ce; background: #eefaf8; padding: 13px; }
      .score-label { color: #52606d; font-size: 8pt; font-weight: 700; text-transform: uppercase; }
      .score-value { color: #0f5f59; font-size: 20pt; font-weight: 700; margin-top: 2px; }
      h2 { font-size: 14pt; margin: 20px 0 10px; }
      .question { border: 1px solid #d9e1e8; break-inside: avoid; margin: 0 0 10px; padding: 11px 12px; }
      .question-heading { align-items: center; display: flex; font-size: 9pt; font-weight: 700; justify-content: space-between; margin-bottom: 7px; text-transform: uppercase; }
      .result { border: 1px solid; padding: 2px 7px; }
      .correct { background: #ecfdf3; border-color: #86d7a4; color: #126a38; }
      .incorrect { background: #fff1f2; border-color: #f4a4ae; color: #a11b2d; }
      .unanswered { background: #f4f6f8; border-color: #c8d0d8; color: #52606d; }
      .prompt { font-weight: 700; margin-bottom: 7px; white-space: pre-wrap; }
      .answer { background: #f7f9fb; padding: 7px 9px; white-space: pre-wrap; }
      .points { color: #52606d; font-size: 9pt; margin-top: 6px; }
      footer { border-top: 1px solid #d9e1e8; color: #657585; font-size: 8pt; margin-top: 18px; padding-top: 8px; }
    </style>
  </head>
  <body>
    <header>
      <div class="brand">Lockedscreen performance report</div>
      <h1>${escapeHtml(exam.title || submission.examTitle || "Exam")}</h1>
    </header>
    <section class="meta">
      <div class="meta-item"><span class="meta-label">Student</span>${escapeHtml(submission.candidateName)}</div>
      <div class="meta-item"><span class="meta-label">Student ID</span>${escapeHtml(submission.candidateId)}</div>
      <div class="meta-item"><span class="meta-label">Class</span>${escapeHtml(studentClass)}</div>
      <div class="meta-item"><span class="meta-label">Subject</span>${escapeHtml(exam.subject || "Not provided")}</div>
      <div class="meta-item"><span class="meta-label">Submitted</span>${escapeHtml(formatDate(submission.submittedAt))}</div>
      <div class="meta-item"><span class="meta-label">Report ID</span>${escapeHtml(submission.id)}</div>
    </section>
    <section class="score">
      <div class="score-item"><div class="score-label">Score</div><div class="score-value">${escapeHtml(score)}</div></div>
      <div class="score-item"><div class="score-label">Percentage</div><div class="score-value">${escapeHtml(percentage)}</div></div>
    </section>
    <h2>Question review</h2>
    ${questionHtml}
    <footer>Generated by Lockedscreen. This report belongs to ${escapeHtml(submission.candidateName)}.</footer>
  </body>
</html>`;

  return { title, plainText, html, questions };
};
