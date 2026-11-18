export const practice = ['Title: Practice Science', 'Q1. What is the chemical symbol for sodium?', 'A. S', 'B. Na', 'ANS: B'];

// Fictional PDF fixtures with byte-correct cross references.
export const makePdf = image => {
  const stream = image ? 'q 600 0 0 240 0 0 cm /Image1 Do Q'
    : `BT /F1 14 Tf 40 200 Td 22 TL ${practice.map((line, i) => `${i ? 'T* ' : ''}(${line}) Tj`).join('\n')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 240] /Resources << ${image ? '/XObject << /Image1 5 0 R >>' : '/Font << /F1 5 0 R >>'} >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    image ? Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1200 /Height 480 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, Buffer.from('\nendstream')])
      : '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  const parts = [Buffer.from('%PDF-1.4\n')], offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(parts.reduce((sum, part) => sum + part.length, 0));
    parts.push(Buffer.from(`${index + 1} 0 obj\n`), Buffer.isBuffer(object) ? object : Buffer.from(object), Buffer.from('\nendobj\n'));
  }
  const xref = parts.reduce((sum, part) => sum + part.length, 0);
  parts.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
  return Buffer.concat(parts);
};
