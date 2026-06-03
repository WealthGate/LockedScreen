import { scrypt } from "scrypt-js";

import type { Exam, ExamConfigPackage, ProtectedConfigPackageFile } from "@lockedscreen/shared-types";

export const automaticPackagePassword = "lockedscreen-local-exam-package-v1";

export interface ImportedProtectedPackage {
  configPackage: ExamConfigPackage;
  exam: Exam;
}

interface ProtectedConfigPackageBundle {
  kind: "package-bundle";
  configPackage: ExamConfigPackage;
  exam: Exam;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isExam = (value: unknown): value is Exam =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  typeof value.mode === "string" &&
  Array.isArray(value.questions);

const isConfigPackage = (value: unknown): value is ExamConfigPackage =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.examId === "string" &&
  typeof value.label === "string" &&
  isRecord(value.integrity) &&
  isRecord(value.studentAccessPolicy) &&
  Array.isArray(value.resultDestinations);

const isProtectedConfigPackageBundle = (value: unknown): value is ProtectedConfigPackageBundle =>
  isRecord(value) &&
  value.kind === "package-bundle" &&
  isConfigPackage(value.configPackage) &&
  isExam(value.exam);

export const isProtectedPackageFile = (value: unknown): value is ProtectedConfigPackageFile =>
  isRecord(value) &&
  value.format === "lockedscreen-config-package" &&
  (value.version === 1 || value.version === 2) &&
  typeof value.packageId === "string" &&
  typeof value.label === "string" &&
  typeof value.payload === "string" &&
  typeof value.salt === "string" &&
  typeof value.iv === "string" &&
  typeof value.authTag === "string";

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const concatBytes = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  const output = new Uint8Array(left.length + right.length);
  output.set(left, 0);
  output.set(right, left.length);
  return output;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
};

const packageChecksumInput = (candidate: ExamConfigPackage): string =>
  JSON.stringify({
    ...candidate,
    integrity: {
      algorithm: candidate.integrity.algorithm,
      checksum: ""
    }
  });

export const calculateConfigPackageChecksum = (candidate: ExamConfigPackage): Promise<string> =>
  sha256Hex(packageChecksumInput(candidate));

const decryptPayload = async (candidate: ProtectedConfigPackageFile, password: string): Promise<string> => {
  const keyBytes = await scrypt(textEncoder.encode(password), base64ToBytes(candidate.salt), 16384, 8, 1, 32);
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64ToBytes(candidate.iv)),
      tagLength: 128
    },
    key,
    toArrayBuffer(concatBytes(base64ToBytes(candidate.payload), base64ToBytes(candidate.authTag)))
  );

  return textDecoder.decode(plaintext);
};

export const unprotectConfigPackage = async (
  candidate: ProtectedConfigPackageFile,
  password = automaticPackagePassword
): Promise<ImportedProtectedPackage> => {
  const payload = await decryptPayload(candidate, password);
  const parsed = JSON.parse(payload) as unknown;
  const packagePayload = candidate.version >= 2 && isProtectedConfigPackageBundle(parsed) ? parsed : null;

  if (!packagePayload) {
    throw new Error("This package does not contain a mobile-readable exam.");
  }

  const checksum = await calculateConfigPackageChecksum(packagePayload.configPackage);
  if (checksum !== candidate.checksum) {
    throw new Error("The exam package integrity check failed.");
  }

  if (packagePayload.exam.id !== packagePayload.configPackage.examId) {
    throw new Error("The exam package does not match its exam.");
  }

  return {
    configPackage: {
      ...packagePayload.configPackage,
      integrity: {
        ...packagePayload.configPackage.integrity,
        lastValidationStatus: "pass",
        lastValidatedAt: new Date().toISOString()
      }
    },
    exam: packagePayload.exam
  };
};

export const importPackageFromFile = async (file: File): Promise<ImportedProtectedPackage> => {
  const raw = JSON.parse(await file.text()) as unknown;
  if (!isProtectedPackageFile(raw)) {
    throw new Error("Choose a valid Lockedscreen .lscp package.");
  }

  return unprotectConfigPackage(raw);
};

export const verifyExamStartCode = async (code: string, configPackage: ExamConfigPackage): Promise<boolean> => {
  const { startCodeHash, startCodeSalt } = configPackage.studentAccessPolicy;
  if (!startCodeHash || !startCodeSalt) {
    return true;
  }

  const normalized = code.trim();
  if (!normalized) {
    return false;
  }

  return (await sha256Hex(`${startCodeSalt}:${normalized}`)) === startCodeHash;
};
