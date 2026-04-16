declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
  }

  export default function pdfParse(input: Buffer): Promise<PdfParseResult>;
}
