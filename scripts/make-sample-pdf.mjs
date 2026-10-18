// Writes a one-page, dependency-free PDF with a title and wrapped body text.
// Used to (re)generate the sample PDFs shipped with the study-resources package:
//
//   node scripts/make-sample-pdf.mjs out.pdf "Title" "Body sentence." "Another."

import { writeFileSync } from "node:fs";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const TITLE_SIZE = 20;
const BODY_SIZE = 12;
const LINE_HEIGHT = 18;
// Helvetica averages about 0.5em per character; keep lines comfortably inside the margins.
const CHARS_PER_LINE = Math.floor((PAGE_WIDTH - MARGIN * 2) / (BODY_SIZE * 0.52));

const escapePdfText = (text) => text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

export const wrapLine = (text, maxChars = CHARS_PER_LINE) => {
  const lines = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
};

export const buildPdf = (title, paragraphs) => {
  const operations = [`BT /F1 ${TITLE_SIZE} Tf ${MARGIN} ${PAGE_HEIGHT - MARGIN} Td (${escapePdfText(title)}) Tj ET`];
  let y = PAGE_HEIGHT - MARGIN - TITLE_SIZE - LINE_HEIGHT;
  for (const paragraph of paragraphs) {
    for (const line of wrapLine(paragraph)) {
      operations.push(`BT /F1 ${BODY_SIZE} Tf ${MARGIN} ${y} Td (${escapePdfText(line)}) Tj ET`);
      y -= LINE_HEIGHT;
    }
    y -= LINE_HEIGHT / 2;
  }
  const stream = operations.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [, , output, title, ...paragraphs] = process.argv;
  if (!output || !title) {
    console.error('usage: node scripts/make-sample-pdf.mjs out.pdf "Title" "Paragraph" ...');
    process.exit(1);
  }
  writeFileSync(output, buildPdf(title, paragraphs));
  console.log(`wrote ${output}`);
}
