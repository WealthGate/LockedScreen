import type { ExamConfigPackage, InstalledAppRole, SubmissionResult } from "@lockedscreen/shared-types";
import { verifyInvigilatorPin } from "./invigilator-pin";

export const assertGoogleRelease = (
  role: InstalledAppRole,
  activePackage: ExamConfigPackage,
  submission: SubmissionResult,
  requestedPackageId: string,
  pin: unknown,
  teacherPin: string
): void => {
  if (activePackage.id !== requestedPackageId || activePackage.examId !== submission.examId) {
    throw new Error("Submit the active exam before requesting Google turn-in.");
  }
  const valid = role === "student"
    ? verifyInvigilatorPin(pin, activePackage.quitUnlockPolicy.pinVerifier)
    : typeof pin === "string" && teacherPin.trim().length > 0 && pin.trim() === teacherPin.trim();
  if (!valid) throw new Error("A valid invigilator PIN is required before release and external Google sign-in.");
};
