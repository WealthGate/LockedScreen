import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { createCanvas } from "@napi-rs/canvas";
import type {
  ImportPreview,
  ImportExtractionInfo,
  ImportedExamMetadata,
  ImportedQuestionDraft,
  MultipleChoiceOption,
  ParseIssue,
  Question
} from "@lockedscreen/shared-types";

const execFileAsync = promisify(execFile);
const questionLinePattern = /^(?:(?:question|ques|q)\s*)?(\d+)[\.\)\:\-]\s*(.+)$/i;
const explicitQuestionPattern = /^question\s*[:\-]\s*(.+)$/i;
const optionLinePattern = /^\(?([A-H])\)?[\.\)\:\-]\s*(.+)$/i;
const answerLinePattern = /^(?:ans(?:wer)?|correct\s*answer)\s*[:\-]\s*([A-H])\b/i;
const separatorPattern = /^(?:[_\-=]{3,}|\*{3,})$/;
const pageNoisePattern = /^(?:page\s+\d+(?:\s+of\s+\d+)?|turn\s+over|continued)$/i;
const imageFilePattern = /\.(?:png|jpe?g|tiff?|bmp|webp)$/i;
const minimumUsefulTextLength = 20;
const maxOcrPdfPages = 30;
const requireFromParser = createRequire(import.meta.url);

export interface ExtractedDocumentText {
  text: string;
  extraction: ImportExtractionInfo;
}

const blankMetadata = (): ImportedExamMetadata => ({
  title: "",
  subject: "",
  className: "",
  form: "",
  teacherName: "",
  schoolName: "",
  instructions: "",
  durationText: "",
  durationMinutes: undefined
});

const normalizeLine = (line: string): string =>
  line
    .replace(/\u00a0/g, " ")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\t/g, " ")
    .trim();

const normalizeText = (text: string): string =>
  text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\f/g, "\n")
    .replace(/[ \t]+/g, " ");

const escapePowerShellLiteral = (value: string): string => value.replace(/'/g, "''");

const hasUsefulText = (text: string): boolean => text.replace(/\s/g, "").length >= minimumUsefulTextLength;

const createOcrWorker = async () => {
  const tesseract = await import("tesseract.js");
  const worker = await tesseract.createWorker("eng", undefined, {
    workerPath: requireFromParser.resolve("tesseract.js/src/worker-script/node/index.js"),
    langPath: dirname(requireFromParser.resolve("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz")),
    cachePath: join(tmpdir(), "lockedscreen-ocr-cache"),
    logger: () => undefined
  });
  await worker.setParameters({
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: tesseract.PSM.AUTO
  });
  return worker;
};

const ocrImageBuffer = async (input: Buffer): Promise<string> => {
  const worker = await createOcrWorker();
  try {
    const result = await worker.recognize(input);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
};

const ocrPdfBuffer = async (input: Buffer): Promise<ExtractedDocumentText> => {
  const [{ getDocument }, worker] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), createOcrWorker()]);

  try {
    const pdfDocumentOptions = {
      data: new Uint8Array(input),
      disableWorker: true,
      isEvalSupported: false,
      isOffscreenCanvasSupported: false,
      useSystemFonts: true
    } as unknown as Parameters<typeof getDocument>[0];
    const loadingTask = getDocument(pdfDocumentOptions);
    const pdf = await loadingTask.promise;
    const pageCount = Math.min(pdf.numPages, maxOcrPdfPages);
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        background: "rgb(255,255,255)"
      }).promise;

      const image = canvas.toBuffer("image/png");
      const result = await worker.recognize(image);
      pageTexts.push(result.data.text);
      page.cleanup();
    }

    const pageLimitReached = pdf.numPages > maxOcrPdfPages;
    if (pageLimitReached) {
      pageTexts.push(
        `\n[OCR stopped after ${maxOcrPdfPages} pages. Split very large scanned PDFs before importing if questions are missing.]\n`
      );
    }

    await pdf.destroy();
    return {
      text: pageTexts.join("\n\n"),
      extraction: {
        method: "pdf-ocr",
        usedOcr: true,
        pageLimitReached,
        maxPages: maxOcrPdfPages
      }
    };
  } finally {
    await worker.terminate();
  }
};

const parseDurationMinutes = (value: string): number | undefined => {
  const normalized = value.toLowerCase();
  const clockMatch = normalized.match(/\b(\d{1,2})\s*:\s*(\d{2})\b/);
  if (clockMatch) {
    const hours = Number(clockMatch[1] ?? "0");
    const minutes = Number(clockMatch[2] ?? "0");
    return hours * 60 + minutes;
  }

  let minutes = 0;
  let matched = false;

  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h)\b/g)) {
    minutes += Number(match[1] ?? "0") * 60;
    matched = true;
  }

  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|min|m)\b/g)) {
    minutes += Number(match[1] ?? "0");
    matched = true;
  }

  if (matched) {
    return Math.round(minutes);
  }

  const plainNumber = normalized.match(/\b(\d{1,3})\b/);
  if (plainNumber) {
    return Number(plainNumber[1] ?? "0");
  }

  return undefined;
};

const buildImportedQuestion = (
  prompt: string,
  options: Array<{ label: string; content: string }>,
  answerLabel: string | undefined,
  issues: ParseIssue[],
  line?: number
): ImportedQuestionDraft | null => {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    issues.push({ line, severity: "error", message: "Question prompt is missing." });
    return null;
  }

  const normalizedOptions: MultipleChoiceOption[] = options
    .map((option) => ({
      id: crypto.randomUUID(),
      label: option.label.toUpperCase(),
      content: option.content.trim()
    }))
    .filter((option) => option.content.length > 0);

  if (normalizedOptions.length < 2) {
    issues.push({ line, severity: "error", message: "Each question needs at least two options." });
    return null;
  }

  const uniqueLabels = new Set(normalizedOptions.map((option) => option.label));
  if (uniqueLabels.size !== normalizedOptions.length) {
    issues.push({ line, severity: "error", message: "Duplicate option labels were found in one question." });
    return null;
  }

  const normalizedAnswerLabel = answerLabel?.trim().toUpperCase();
  const selectedCorrectOptionId = normalizedAnswerLabel
    ? normalizedOptions.find((option) => option.label === normalizedAnswerLabel)?.id
    : undefined;

  if (normalizedAnswerLabel && !selectedCorrectOptionId) {
    issues.push({
      line,
      severity: "warning",
      message: `Detected answer "${normalizedAnswerLabel}" does not match any option label.`
    });
  }

  return {
    id: crypto.randomUUID(),
    prompt: trimmedPrompt,
    points: 1,
    options: normalizedOptions,
    selectedCorrectOptionId,
    detectedAnswerLabel: normalizedAnswerLabel
  };
};

const parseTaggedQuestions = (text: string, issues: ParseIssue[]): ImportedQuestionDraft[] =>
  (text.match(/\[QUESTION\][\s\S]*?\[\/QUESTION\]/gi) ?? [])
    .map((block) => {
      const promptMatch = block
        .replace(/\[QUESTION\]/i, "")
        .replace(/\[\/QUESTION\]/i, "")
        .replace(/\[OPTION\][\s\S]*/gi, "")
        .replace(/\[ANSWER\][\s\S]*/gi, "")
        .trim();

      const options = Array.from(
        block.matchAll(/\[OPTION\]\s*([A-Z])[\.\)\:\-]?\s*([\s\S]*?)(?=\[OPTION\]|\[ANSWER\]|\[\/QUESTION\])/gi)
      ).map((match) => ({
        label: match[1] ?? "",
        content: match[2] ?? ""
      }));

      const answerLabel = block.match(/\[ANSWER\]\s*([A-Z])/i)?.[1];
      return buildImportedQuestion(promptMatch, options, answerLabel, issues);
    })
    .filter((question): question is ImportedQuestionDraft => question !== null);

const looksLikeQuestionStart = (line: string): boolean =>
  questionLinePattern.test(line) || explicitQuestionPattern.test(line);

const parseLineQuestions = (text: string, issues: ParseIssue[]): ImportedQuestionDraft[] => {
  const lines = normalizeText(text).split("\n");
  const questions: ImportedQuestionDraft[] = [];
  let prompt = "";
  let options: Array<{ label: string; content: string }> = [];
  let answerLabel: string | undefined;
  let questionLine: number | undefined;
  let activeOptionLabel: string | null = null;
  let seenQuestion = false;

  const flush = (): void => {
    if (!prompt.trim() && options.length === 0 && !answerLabel) {
      return;
    }

    const question = buildImportedQuestion(prompt, options, answerLabel, issues, questionLine);
    if (question) {
      questions.push(question);
    }

    prompt = "";
    options = [];
    answerLabel = undefined;
    questionLine = undefined;
    activeOptionLabel = null;
  };

  lines.forEach((rawLine, index) => {
    const line = normalizeLine(rawLine);
    if (!line || separatorPattern.test(line) || pageNoisePattern.test(line)) {
      return;
    }

    const questionMatch = line.match(questionLinePattern) ?? line.match(explicitQuestionPattern);
    if (questionMatch) {
      if (seenQuestion) {
        flush();
      }

      seenQuestion = true;
      questionLine = index + 1;
      activeOptionLabel = null;
      prompt = (questionMatch[2] ?? questionMatch[1] ?? "").trim();
      return;
    }

    if (!seenQuestion) {
      return;
    }

    const answerMatch = line.match(answerLinePattern);
    if (answerMatch) {
      answerLabel = (answerMatch[1] ?? "").toUpperCase();
      activeOptionLabel = null;
      return;
    }

    const optionMatch = line.match(optionLinePattern);
    if (optionMatch) {
      const label = (optionMatch[1] ?? "").toUpperCase();
      const content = optionMatch[2] ?? "";
      options.push({ label, content });
      activeOptionLabel = label;
      return;
    }

    if (activeOptionLabel) {
      options = options.map((option) =>
        option.label === activeOptionLabel ? { ...option, content: `${option.content} ${line}`.trim() } : option
      );
      return;
    }

    prompt = `${prompt} ${line}`.trim();
  });

  flush();
  return questions;
};

const extractHeaderText = (text: string): string => {
  const normalized = normalizeText(text);
  const taggedIndex = normalized.search(/\[QUESTION\]/i);
  if (taggedIndex >= 0) {
    return normalized.slice(0, taggedIndex);
  }

  const lines = normalized.split("\n");
  const firstQuestionIndex = lines.findIndex((line) => looksLikeQuestionStart(normalizeLine(line)));
  return firstQuestionIndex >= 0 ? lines.slice(0, firstQuestionIndex).join("\n") : normalized;
};

const extractMetadata = (text: string, issues: ParseIssue[]): ImportedExamMetadata => {
  const metadata = blankMetadata();
  const headerLines = extractHeaderText(text)
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean);

  const leftovers: string[] = [];

  for (const line of headerLines) {
    let matched = true;
    let value = "";

    if ((value = line.match(/^(?:heading|exam\s*title|title|paper|assessment|test|exam)\s*[:\-]\s*(.+)$/i)?.[1] ?? "")) {
      metadata.title ||= value.trim();
    } else if ((value = line.match(/^subject\s*[:\-]\s*(.+)$/i)?.[1] ?? "")) {
      metadata.subject ||= value.trim();
    } else if ((value = line.match(/^(?:class|grade|year|course)\s*[:\-]\s*(.+)$/i)?.[1] ?? "")) {
      metadata.className ||= value.trim();
    } else if ((value = line.match(/^form\s*[:\-]?\s*(.+)$/i)?.[1] ?? "")) {
      metadata.form ||= value.trim();
    } else if ((value = line.match(/^(?:teacher|examiner|lecturer|instructor)\s*[:\-]\s*(.+)$/i)?.[1] ?? "")) {
      metadata.teacherName ||= value.trim();
    } else if ((value = line.match(/^(?:school|college|academy|institution|department)\s*[:\-]\s*(.+)$/i)?.[1] ?? "")) {
      metadata.schoolName ||= value.trim();
    } else if ((value = line.match(/^(?:time|duration)\s*[:\-]\s*(.+)$/i)?.[1] ?? "")) {
      metadata.durationText ||= value.trim();
    } else if ((value = line.match(/^instructions?\s*[:\-]\s*(.+)$/i)?.[1] ?? "")) {
      metadata.instructions = `${metadata.instructions} ${value.trim()}`.trim();
    } else {
      matched = false;
    }

    if (!matched) {
      leftovers.push(line);
    }
  }

  if (!metadata.schoolName) {
    const schoolLine = leftovers.find((line) => /school|college|academy|university|department/i.test(line));
    if (schoolLine) {
      metadata.schoolName = schoolLine;
    }
  }

  if (!metadata.title) {
    metadata.title =
      leftovers.find((line) => /exam|test|assessment|quiz|paper/i.test(line)) ??
      leftovers.find((line) => !/school|college|academy|university|department/i.test(line)) ??
      "";
  }

  if (!metadata.instructions) {
    metadata.instructions = leftovers
      .filter((line) => line !== metadata.title && line !== metadata.schoolName)
      .filter((line) => !/^form\s+\d+/i.test(line))
      .join(" ")
      .trim();
  }

  if (metadata.durationText) {
    metadata.durationMinutes = parseDurationMinutes(metadata.durationText);
  }

  if (!metadata.title) {
    issues.push({
      severity: "warning",
      message: "Exam heading was not detected automatically. Review the title before saving."
    });
  }

  return metadata;
};

export const parseExamDocument = (fileName: string, text: string): ImportPreview => {
  const issues: ParseIssue[] = [];
  const normalizedText = normalizeText(text);
  const metadata = extractMetadata(normalizedText, issues);
  const questions = normalizedText.match(/\[QUESTION\]/i)
    ? parseTaggedQuestions(normalizedText, issues)
    : parseLineQuestions(normalizedText, issues);

  if (questions.length === 0) {
    issues.push({
      severity: "warning",
      message: "No questions were extracted. Review the document formatting and question numbering."
    });
  }

  const unresolvedAnswerCount = questions.filter((question) => !question.selectedCorrectOptionId).length;
  if (unresolvedAnswerCount > 0) {
    issues.push({
      severity: "warning",
      message: `${unresolvedAnswerCount} question${unresolvedAnswerCount === 1 ? "" : "s"} still need a correct option selected before saving.`
    });
  }

  return {
    sourceFileName: fileName.split(/[\\/]/).pop() ?? fileName,
    metadata,
    questions,
    issues,
    sourceText: normalizedText
  };
};

export const parseStructuredQuestions = (text: string): ImportPreview => parseExamDocument("import.txt", text);

export const extractExamDocumentText = async (fileName: string, input: Buffer): Promise<ExtractedDocumentText> => {
  const lower = fileName.toLowerCase();

  if (lower.endsWith(".txt")) {
    return {
      text: input.toString("utf-8"),
      extraction: { method: "text", usedOcr: false }
    };
  }

  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: input });
    return {
      text: result.value,
      extraction: { method: "docx", usedOcr: false }
    };
  }

  if (lower.endsWith(".doc")) {
    return {
      text: await withTempLegacyDocument(".doc", input, extractDocTextWithWord),
      extraction: { method: "doc", usedOcr: false }
    };
  }

  if (lower.endsWith(".pdf")) {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(input);
    if (hasUsefulText(result.text)) {
      return {
        text: result.text,
        extraction: { method: "pdf-text", usedOcr: false }
      };
    }

    const ocrResult = await ocrPdfBuffer(input);
    if (hasUsefulText(ocrResult.text)) {
      return ocrResult;
    }

    return {
      text: result.text,
      extraction: { method: "pdf-text", usedOcr: false }
    };
  }

  if (imageFilePattern.test(lower)) {
    return {
      text: await ocrImageBuffer(input),
      extraction: { method: "image-ocr", usedOcr: true }
    };
  }

  throw new Error("Unsupported file type. Use TXT, DOC, DOCX, PDF, PNG, JPG, TIFF, BMP, or WEBP.");
};

const withTempLegacyDocument = async (extension: ".doc", input: Buffer, operation: (filePath: string) => Promise<string>) => {
  const tempDir = await mkdtemp(join(tmpdir(), "lockedscreen-doc-import-"));
  const filePath = join(tempDir, `import${extension}`);

  try {
    await writeFile(filePath, input);
    return await operation(filePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const extractDocTextWithWord = async (filePath: string): Promise<string> => {
  if (process.platform !== "win32") {
    throw new Error("Legacy .doc files can only be imported on Windows. Convert the file to .docx or PDF first.");
  }

  const tempDir = await mkdtemp(join(tmpdir(), "lockedscreen-word-export-"));
  const outputPath = join(tempDir, "import.txt");
  const escapedInputPath = escapePowerShellLiteral(filePath);
  const escapedOutputPath = escapePowerShellLiteral(outputPath);
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "$word = $null",
    "$document = $null",
    "try {",
    "  $word = New-Object -ComObject Word.Application",
    "  $word.Visible = $false",
    `  $document = $word.Documents.Open('${escapedInputPath}', $false, $true)`,
    `  $document.SaveAs([ref]'${escapedOutputPath}', [ref]2)`,
    "  $document.Close()",
    "  $document = $null",
    "} finally {",
    "  if ($document -ne $null) { try { $document.Close() } catch {} }",
    "  if ($word -ne $null) { try { $word.Quit() } catch {} }",
    "}"
  ].join("; ");

  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
    return await readFile(outputPath, "utf-8");
  } catch {
    throw new Error(
      "Unable to read this .doc file automatically. Microsoft Word may be missing on this Windows device. Convert it to .docx or PDF and try again."
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

export const extractTextFromBuffer = async (fileName: string, input: Buffer): Promise<string> => {
  const extracted = await extractExamDocumentText(fileName, input);
  return extracted.text;
};

export const toQuestions = (questions: ImportedQuestionDraft[]): Question[] =>
  questions
    .filter((question): question is ImportedQuestionDraft & { selectedCorrectOptionId: string } => Boolean(question.selectedCorrectOptionId))
    .map((question) => ({
      id: question.id,
      type: "multiple-choice",
      prompt: question.prompt,
      points: question.points,
      options: question.options,
      correctOptionId: question.selectedCorrectOptionId
    }));
