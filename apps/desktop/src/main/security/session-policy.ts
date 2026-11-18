import type { ExamConfigPackage } from "@lockedscreen/shared-types";
import { isPinVerifier, verifyInvigilatorPin } from "./invigilator-pin";

const examChannels = new Set([
  "app:getSnapshot", "app:getLaunchContext", "updates:getState", "session:begin", "session:end",
  "exam:submit", "studentLms:turnIn"
]);

export const createSessionStartBarrier = () => {
  const independent = new Set([
    "app:getSnapshot", "app:getLaunchContext", "updates:getState",
    "session:begin", "session:end", "session:launchAlternateDesktop"
  ]);
  let pending = 0;
  return {
    assertIdle(): void {
      if (pending) throw new Error("Wait for the current sign-in, import, or workspace operation to finish before starting an exam.");
    },
    async run<T>(channel: string, operation: () => T | Promise<T>): Promise<T> {
      const tracked = !independent.has(channel);
      if (tracked) pending++;
      try { return await operation(); }
      finally { if (tracked) pending--; }
    }
  };
};

export const unsafeProductionSwitch = (hasSwitch: (name: string) => boolean): string | undefined => [
  "remote-debugging-port", "remote-debugging-pipe", "no-sandbox", "disable-gpu-sandbox", "disable-web-security"
].find(hasSwitch);

export const assertSessionOperation = (locked: boolean, channel: string): void => {
  if (locked && !examChannels.has(channel)) {
    throw new Error("The exam is locked. Invigilator PIN release is required before leaving the exam or changing its controls.");
  }
};

export const assertSessionExitPin = (config: ExamConfigPackage, pin: unknown, teacherPin: string): void => {
  const valid = config.quitUnlockPolicy.pinVerifier
    ? verifyInvigilatorPin(pin, config.quitUnlockPolicy.pinVerifier)
    : typeof pin === "string" && pin.length <= 128 && teacherPin.trim().length > 0 && pin.trim() === teacherPin.trim();
  if (!valid) throw new Error("Incorrect invigilator PIN. The exam remains locked.");
};

export const assertSessionPinConfigured = (config: ExamConfigPackage, teacherPin: string, allowLocalPin: boolean): void => {
  const verifier = config.quitUnlockPolicy.pinVerifier;
  if (verifier && isPinVerifier(verifier)) return;
  if (verifier || !allowLocalPin || !teacherPin.trim() || teacherPin.length > 128) {
    throw new Error("Ask your teacher to configure a valid invigilator PIN and re-export this exam package.");
  }
};

export const isSameSession = (
  current: { examId: string; packageId: string; mode: string },
  requested: { examId: string; packageId: string; mode: string }
): boolean => current.examId === requested.examId && current.packageId === requested.packageId && current.mode === requested.mode;
