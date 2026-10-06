import type { ImportPreview, ImportExtractionInfo } from "@lockedscreen/shared-types";

export const extractExamDocumentText = async (_name: string, _buffer: Buffer): Promise<{ text: string; extraction: ImportExtractionInfo }> => {
  throw new Error("Document authoring is available in the Teacher edition. Open a teacher's .lscp package instead.");
};

export const parseExamDocument = (_name: string, _text: string): ImportPreview => {
  throw new Error("Document authoring is available in the Teacher edition.");
};
