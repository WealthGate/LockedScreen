import assert from "node:assert/strict";
import test from "node:test";

import {
  extractExamDocumentText,
  parseExamDocument,
  supportedQuestionImportExtensions
} from "./index";

const createTextPdf = (lines: string[]): Buffer => {
  const escapePdfText = (value: string) => value.replace(/([\\()])/g, "\\$1");
  const commands = ["BT", "/F1 12 Tf", "50 750 Td"];
  lines.forEach((line, index) => {
    if (index > 0) {
      commands.push("0 -20 Td");
    }
    commands.push(`(${escapePdfText(line)}) Tj`);
  });
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
};

const classicQuestionLines = [
  "Q1. What is two plus two?",
  "A. 3",
  "B. 4",
  "C. 5",
  "ANS: B"
];

test("extracts and parses a typed PDF with the current PDF.js engine", async () => {
  const extracted = await extractExamDocumentText("questions.pdf", createTextPdf(classicQuestionLines));
  const preview = parseExamDocument("questions.pdf", extracted.text);

  assert.equal(extracted.extraction.method, "pdf-text");
  assert.equal(extracted.extraction.usedOcr, false);
  assert.equal(preview.questions.length, 1);
  assert.equal(preview.questions[0]?.options.length, 3);
  assert.equal(preview.questions[0]?.detectedAnswerLabel, "B");
});

test("returns a readable error for a corrupt PDF", async () => {
  await assert.rejects(
    () => extractExamDocumentText("broken.pdf", Buffer.from("not a PDF")),
    /Unable to read this PDF/
  );
});

test("extracts HTML and RTF documents through the office parser", async () => {
  const html = `<h1>Exam</h1>${classicQuestionLines.map((line) => `<p>${line}</p>`).join("")}`;
  const rtf = `{\\rtf1\\ansi ${classicQuestionLines.join("\\par ")}\\par}`;

  const htmlResult = await extractExamDocumentText("questions.html", Buffer.from(html));
  const rtfResult = await extractExamDocumentText("questions.rtf", Buffer.from(rtf));

  assert.equal(parseExamDocument("questions.html", htmlResult.text).questions.length, 1);
  assert.equal(parseExamDocument("questions.rtf", rtfResult.text).questions.length, 1);
  assert.equal(htmlResult.extraction.method, "office");
  assert.equal(rtfResult.extraction.method, "office");
});

test("keeps plain text formats direct and exposes all picker extensions", async () => {
  const extracted = await extractExamDocumentText("questions.md", Buffer.from(classicQuestionLines.join("\n")));

  assert.equal(extracted.extraction.method, "text");
  assert.equal(parseExamDocument("questions.md", extracted.text).questions.length, 1);
  assert.ok(supportedQuestionImportExtensions.includes("pdf"));
  assert.ok(supportedQuestionImportExtensions.includes("odt"));
  assert.ok(supportedQuestionImportExtensions.includes("xlsx"));
});
