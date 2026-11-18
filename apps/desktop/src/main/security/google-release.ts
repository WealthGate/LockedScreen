import type { ExamConfigPackage, InstalledAppRole, SubmissionResult } from "@lockedscreen/shared-types";
import { assertSessionExitPin } from "./session-policy";

export const assertGoogleRelease = (
  _role: InstalledAppRole,
  activePackage: ExamConfigPackage,
  submission: SubmissionResult,
  requestedPackageId: string,
  pin: unknown,
  teacherPin: string
): void => {
  if (activePackage.id !== requestedPackageId || activePackage.examId !== submission.examId) {
    throw new Error("Submit the active exam before requesting Google turn-in.");
  }
  try { assertSessionExitPin(activePackage, pin, teacherPin); }
  catch { throw new Error("A valid invigilator PIN is required before release and external Google sign-in."); }
};
