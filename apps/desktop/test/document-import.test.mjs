import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createCanvas } from '@napi-rs/canvas';
import JSZip from 'jszip';
import { makePdf, practice } from './fixtures/practice-pdf.mjs';

test('patched document engine imports typed PDF, DOCX, image OCR and scanned PDF without network data', async t => {
  const root = resolve('tmp'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'acceptance-parser-'));
  try {
    const outfile = join(directory, 'parser.mjs');
    await build({ entryPoints: ['packages/parser/src/index.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile, logLevel: 'silent' });
    const { extractExamDocumentText, parseExamDocument } = await import(pathToFileURL(outfile));
    await t.test('downloadable passage template and mixed reading groups retain text, order and answer keys', async () => {
      const template = await readFile('docs/templates/doc-friendly-question-template.txt', 'utf8');
      const standalone = 'Question:\nWhich colour?\nA. Blue\nB. Red\nANS: A';
      const tagged = '[QUESTION]\nWhat returned?\n[OPTION]\nA. Light\n[OPTION]\nB. Rain\n[ANSWER]\nB\n[/QUESTION]';
      const text = template + '\n' + standalone + '\n[PASSAGE]\nRain\n1. A numbered paragraph.\n\nB. A second paragraph.\n[QUESTIONS]\n' + tagged + '\n[/PASSAGE]';
      const preview = parseExamDocument('reading.txt', text);
      assert.deepEqual(preview.issues, []);
      assert.equal(preview.questions.length, 4);
      assert.equal(preview.questions[2].prompt,'Which colour?');
      assert.equal(preview.passages.length, 2);
      assert.deepEqual(preview.passages[0].questionIds, preview.questions.slice(0,2).map(q=>q.id));
      assert.deepEqual(preview.passages[1].questionIds, [preview.questions[3].id]);
      assert.equal(preview.passages[1].text,'1. A numbered paragraph.\n\nB. A second paragraph.');
      assert.equal(preview.metadata.title,'Reading comprehension');
      assert.ok(preview.questions.every(q=>q.selectedCorrectOptionId));
      assert.equal(parseExamDocument('old.txt', standalone).passages, undefined);
      for (const bad of [template.replace('[/PASSAGE]', ''), template.replace('[QUESTIONS]',''), '[PASSAGE]\nTitle\n[QUESTIONS]\n'+standalone+'\n[/PASSAGE]', text.replace('[/QUESTION]', '')]) {
        assert.ok(parseExamDocument('broken.txt',bad).issues.some(i=>i.severity==='error'));
      }
    });
    await t.test('typed PDF retains questions and the answer key', async () => {
      const result = await extractExamDocumentText('practice.pdf', makePdf());
      assert.equal(result.extraction.method, 'pdf-text');
      assert.match(result.text, /chemical symbol for sodium/);
      const preview = parseExamDocument('practice.pdf', result.text);
      assert.equal(preview.questions.length, 1);
      assert.equal(preview.questions[0].options.length, 2);
      assert(preview.questions[0].selectedCorrectOptionId);
    });
    await t.test('DOCX XML extraction uses the patched parser', async () => {
      const zip = new JSZip();
      zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
      zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${practice.map(line => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
      const result = await extractExamDocumentText('practice.docx', await zip.generateAsync({ type: 'nodebuffer' }));
      assert.equal(result.extraction.method, 'docx');
      assert.match(result.text, /ANS: B/);
    });
    const canvas = createCanvas(1200, 480), ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1200, 480);
    ctx.fillStyle = 'black'; ctx.font = 'bold 42px Arial';
    ctx.fillText('PRACTICE SCIENCE EXAM', 50, 100);
    ctx.fillText('THE SYMBOL FOR SODIUM IS Na', 50, 180);
    await t.test('local OCR still recognizes an image', async () => {
      const result = await extractExamDocumentText('practice.png', canvas.toBuffer('image/png'));
      assert.equal(result.extraction.method, 'image-ocr');
      assert.match(result.text, /SODIUM/i);
    });
    await t.test('scanned PDF renders through the patched PDF.js engine before OCR', async () => {
      const result = await extractExamDocumentText('scan.pdf', makePdf(canvas.toBuffer('image/jpeg')));
      assert.equal(result.extraction.method, 'pdf-ocr');
      assert.match(result.text, /SODIUM/i);
    });
    await t.test('malformed input rejects and does not poison later imports', async () => {
      await assert.rejects(extractExamDocumentText('invalid.pdf', Buffer.from('not a PDF')));
      assert.match((await extractExamDocumentText('practice.pdf', makePdf())).text, /Practice Science/);
    });
  } finally {
    if (!directory.startsWith(root + sep)) throw new Error('Test cleanup escaped its workspace');
    await rm(directory, { recursive: true, force: true });
  }
});
