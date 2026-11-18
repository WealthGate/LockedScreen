import type { StudentLmsBinding, StudentLmsTurnInState } from "@lockedscreen/shared-types";

export const needsStudentLmsTurnIn = (
  binding: StudentLmsBinding | undefined,
  state: StudentLmsTurnInState | undefined
): boolean => Boolean(binding?.enabled && (state?.status !== "success" ||
  (binding.provider === "google-classroom" && state.gradeSyncStatus === "failed")));
