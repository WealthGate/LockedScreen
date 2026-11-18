import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
