import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { safeStorage, type BrowserWindow } from "electron";
import type { ExamConfigPackage } from "@lockedscreen/shared-types";
import { signInStudent, refreshStudentSignIn, disconnectStudentSignIn, type StudentOAuthTokens } from "./student-lms-turnin";

export const needsStudentSignIn = (config: ExamConfigPackage): boolean =>
  config.externalDeliveryMode !== "lockdown-only" && config.studentLmsBinding.enabled;
const fingerprint = (config: ExamConfigPackage): string => createHash("sha256")
  .update(JSON.stringify([config.id, config.examId, Object.entries(config.studentLmsBinding).sort(([left], [right]) => left.localeCompare(right))])).digest("hex");
const handlePattern = /^[a-f0-9]{64}$/;
interface Prepared { binding: string; tokens: StudentOAuthTokens; expiresAt: number }

// Only the main process holds this authorization. A separate secure-desktop shell
// receives a DPAPI-encrypted, one-use handoff, never credentials in its arguments.
export class StudentExamAuth {
  private current: Prepared | null = null;
  constructor(private readonly directory: string) {}

  async prepare(config: ExamConfigPackage, parent: BrowserWindow | null): Promise<void> {
    await this.clear();
    if (!needsStudentSignIn(config)) return;
    const binding = config.studentLmsBinding;
    if (!binding.courseId.trim() || !binding.assignmentId.trim()) throw new Error("Select a Classroom class and assignment, then save and re-export the exam package before starting.");
    const tokens = await signInStudent(binding, parent, true).catch(error => {
      const message = error instanceof Error ? error.message.replace(/The local exam submission is saved\.\s*/g, "") : "Google authorization was not completed.";
      throw new Error(`Pre-exam student sign-in failed. The exam has not started. ${message}`);
    });
    this.current = { binding: fingerprint(config), tokens, expiresAt: Date.now() + 12 * 60 * 60_000 };
  }

  async accessToken(config: ExamConfigPackage): Promise<string> {
    const prepared = this.current;
    if (!prepared || prepared.binding !== fingerprint(config) || prepared.expiresAt <= Date.now()) {
      throw new Error("Student authorization is unavailable for this exam. The result is saved. Ask the invigilator to release the exam before reconnecting; lockdown remains active.");
    }
    prepared.tokens = await refreshStudentSignIn(config.studentLmsBinding, prepared.tokens);
    return prepared.tokens.accessToken;
  }

  async createHandoff(): Promise<string | undefined> {
    if (!this.current) return undefined;
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows protected student sign-in storage is unavailable. The exam has not started.");
    await mkdir(this.directory, { recursive: true });
    for (const name of await readdir(this.directory)) {
      if (!handlePattern.test(name)) continue;
      const file = join(this.directory, name);
      const info = await lstat(file);
      if (info.isFile() && !info.isSymbolicLink() && Date.now() - info.mtimeMs > 120_000) await unlink(file).catch(() => {});
    }
    const handle = randomBytes(32).toString("hex");
    await writeFile(join(this.directory, handle), safeStorage.encryptString(JSON.stringify({ ...this.current, handoffExpiresAt: Date.now() + 120_000 })), { flag: "wx", mode: 0o600 });
    return handle;
  }

  async takeHandoff(handle: string | null, config: ExamConfigPackage): Promise<void> {
    if (!needsStudentSignIn(config)) return;
    if (!handle || !handlePattern.test(handle) || !safeStorage.isEncryptionAvailable()) throw new Error("Student sign-in must complete before opening the secure desktop. Return to the exam list and start again.");
    const file = join(this.directory, handle);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Invalid student sign-in handoff.");
    const claimed = join(this.directory, `${handle}.claimed-${randomBytes(8).toString("hex")}`);
    await rename(file, claimed);
    let prepared: Prepared & { handoffExpiresAt: number };
    try { prepared = JSON.parse(safeStorage.decryptString(await readFile(claimed))); }
    finally { await unlink(claimed).catch(() => {}); }
    if (prepared.binding !== fingerprint(config) || prepared.handoffExpiresAt <= Date.now() || prepared.expiresAt <= Date.now()) throw new Error("Student sign-in handoff expired or does not match this exam. Return to the exam list and start again.");
    this.current = prepared;
  }

  forget(): void { this.current = null; }

  async removeHandoff(handle: string | undefined): Promise<void> {
    if (handle && handlePattern.test(handle)) await unlink(join(this.directory, handle)).catch(() => {});
  }

  async clear(): Promise<void> {
    const previous = this.current;
    this.current = null;
    if (previous) await disconnectStudentSignIn(previous.tokens).catch(() => {});
  }
}
