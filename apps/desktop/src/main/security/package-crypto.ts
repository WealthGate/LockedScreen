import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

import type { Exam, ExamConfigPackage, ProtectedConfigPackageFile } from "@lockedscreen/shared-types";
import { calculateConfigPackageChecksum, withStampedIntegrity } from "@lockedscreen/storage";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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

const isConfigPackage = (value: unknown): value is ExamConfigPackage =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.examId === "string" &&
  typeof value.label === "string" &&
  isRecord(value.browserPolicy) &&
  isRecord(value.sessionPolicy) &&
  isRecord(value.integrity);

const isExam = (value: unknown): value is Exam =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.title === "string" &&
  Array.isArray(value.questions) &&
  typeof value.mode === "string";

interface ProtectedConfigPackageBundle {
  kind: "package-bundle";
  configPackage: ExamConfigPackage;
  exam: Exam;
}

const isProtectedConfigPackageBundle = (value: unknown): value is ProtectedConfigPackageBundle =>
  isRecord(value) &&
  value.kind === "package-bundle" &&
  isConfigPackage(value.configPackage) &&
  isExam(value.exam);

export const protectConfigPackage = (
  configPackage: ExamConfigPackage,
  password: string,
  exam?: Exam | null
): ProtectedConfigPackageFile => {
  const stamped = withStampedIntegrity({
    ...configPackage,
    integrity: {
      ...configPackage.integrity,
      lastValidatedAt: new Date().toISOString(),
      lastValidationStatus: "pass"
    }
  });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = exam
    ? JSON.stringify({
        kind: "package-bundle",
        configPackage: stamped,
        exam
      } satisfies ProtectedConfigPackageBundle)
    : JSON.stringify(stamped);
  const payload = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    format: "lockedscreen-config-package",
    version: exam ? 2 : 1,
    packageId: stamped.id,
    label: stamped.label,
    examTitle: exam?.title,
    checksum: stamped.integrity.checksum,
    passwordHint: stamped.passwordHint,
    algorithm: "aes-256-gcm",
    digest: "sha256",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    payload: payload.toString("base64"),
    exportedAt: new Date().toISOString()
  };
};

export const unprotectConfigPackage = (
  candidate: ProtectedConfigPackageFile,
  password: string
): { configPackage: ExamConfigPackage; exam: Exam | null } => {
  const key = scryptSync(password, Buffer.from(candidate.salt, "base64"), 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(candidate.iv, "base64"));
  decipher.setAuthTag(Buffer.from(candidate.authTag, "base64"));
  const payload = Buffer.concat([
    decipher.update(Buffer.from(candidate.payload, "base64")),
    decipher.final()
  ]).toString("utf-8");
  const parsed = JSON.parse(payload) as unknown;

  const packagePayload =
    candidate.version >= 2
      ? isProtectedConfigPackageBundle(parsed)
        ? parsed
        : null
      : isConfigPackage(parsed)
        ? {
            kind: "package-bundle" as const,
            configPackage: parsed,
            exam: null
          }
        : null;

  if (!packagePayload) {
    throw new Error("Invalid configuration package payload.");
  }

  const stamped = withStampedIntegrity({
    ...packagePayload.configPackage,
    integrity: {
      ...packagePayload.configPackage.integrity,
      lastValidatedAt: new Date().toISOString(),
      lastValidationStatus: calculateConfigPackageChecksum(packagePayload.configPackage) === candidate.checksum ? "pass" : "fail"
    }
  });

  if (stamped.integrity.checksum !== candidate.checksum) {
    throw new Error("Configuration package integrity validation failed.");
  }

  if (packagePayload.exam && packagePayload.exam.id !== stamped.examId) {
    throw new Error("Configuration package exam mismatch.");
  }

  return {
    configPackage: stamped,
    exam: packagePayload.exam
  };
};
