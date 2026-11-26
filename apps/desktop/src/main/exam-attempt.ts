import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { safeStorage } from "electron";
import { join } from "node:path";
import { createSession } from "@lockedscreen/exam-engine";
import { publisherGoogleConnection, type Exam, type ExamConfigPackage, type AttemptProgress, type SubmissionResult } from "@lockedscreen/shared-types";

const filename = (value: string) => createHash("sha256").update(value).digest("hex");
async function read(path: string) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function replace(path: string, data: string) {
  const tmp = path + "." + randomUUID() + ".tmp";
  try { await writeFile(tmp, data, { flush:true }); await rename(tmp,path); }
  finally { await rm(tmp,{force:true}).catch(()=>{}); }
}
async function online(path: string, body: object, token?: string) {
  const response = await fetch(publisherGoogleConnection.origin + "/v1/attempt/" + path, {
    method:"POST", redirect:"error", signal:AbortSignal.timeout(20000),
    headers:{"Content-Type":"application/json", ...(token ? {Authorization:"Bearer " + token} : {})}, body:JSON.stringify(body)
  }).catch(()=>{throw new Error("Online attempt verification is unavailable. Reconnect and try again.");});
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Attempt verification failed.");
  return result;
}
export class ExamAttempts {
  private path = "";
  private receipt = "";
  progress?: AttemptProgress;
  private pending: Promise<void> = Promise.resolve();
  constructor(private directory:string) {}

  async prepare(config:ExamConfigPackage, exam:Exam, proof:string, verifyResume:()=>number, submissions:SubmissionResult[], className:string) {
    await mkdir(this.directory,{recursive:true});
    const keyPath = join(this.directory,filename(config.id) + ".key");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows protected storage is unavailable. Your exam has not started.");
    let sealed = await read(keyPath);
    if (!sealed) {
      try { await writeFile(keyPath,safeStorage.encryptString(randomBytes(32).toString("base64url")).toString("base64"),{flag:"wx",flush:true}); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      sealed = await read(keyPath);
    }
    if (!sealed) throw new Error("Could not open the Windows attempt key.");
    const lease=safeStorage.decryptString(Buffer.from(sealed,"base64"));
    const provider = config.externalDeliveryMode !== "lockdown-only" && config.studentLmsBinding.enabled && config.studentLmsBinding.provider === "microsoft-365" ? "microsoft" : "google";
    const result = await online("claim",{packageId:config.id,lease,provider},proof);
    if (typeof result.subject!=="string" || typeof result.email!=="string" || !/^[\w-]{43}$/.test(result.receipt) || !Number.isFinite(Date.parse(result.startedAt))) throw new Error("Invalid attempt verification response.");
    const matches = (value:string) => [result.subject,result.email].some(id=>id.toLowerCase()===value.trim().toLowerCase());
    const access=config.studentAccessPolicy;
    if ((access.assignedCandidateIds.length || access.assignedClassNames.length) && !access.assignedCandidateIds.some(matches) &&
      !access.assignedClassNames.some(c=>c.toLowerCase()===className.trim().toLowerCase())) throw new Error("This exam is assigned to another student or class.");
    if (submissions.some(s=>(s.packageId===config.id || (!s.packageId && s.examId===exam.id)) && matches(s.candidateId))) throw new Error("This exam has already been submitted.");
    const path=join(this.directory,filename(config.id + ":" + provider + ":" + result.subject) + ".json");
    const old=await read(path);
    const extraMinutes=result.repeated || old ? verifyResume() : 0;
    const progress:AttemptProgress=old ? JSON.parse(old) : { session:createSession(exam,{id:result.email,name:result.name || result.email,className},new Date(result.startedAt)),questionIndex:0 };
    if (old && (progress.session.examId!==exam.id || progress.session.responses.some(r=>!exam.questions.some(q=>q.id===r.questionId)))) throw new Error("Restore the original exam package to continue this attempt.");
    if (extraMinutes) progress.session.endsAt=new Date(Math.max(Date.now(),Date.parse(progress.session.endsAt))+extraMinutes*60000).toISOString();
    await replace(path,JSON.stringify(progress));
    return {path,receipt:result.receipt as string};
  }
  async open(handle:{path:string;receipt:string}) {
    if (!handle.path.startsWith(this.directory + "\\") && !handle.path.startsWith(this.directory + "/")) throw new Error("Invalid attempt handoff.");
    this.progress=JSON.parse(await readFile(handle.path,"utf8"));
    this.path=handle.path; this.receipt=handle.receipt;
  }
  save(progress:AttemptProgress) {
    const current=this.progress;
    if (!current || !this.path || current.session.examId!==progress.session.examId) throw new Error("No matching exam attempt is open.");
    const next={session:{...current.session,responses:progress.session.responses,spokenAnswers:progress.session.spokenAnswers},questionIndex:progress.questionIndex};
    const path=this.path;
    const write=this.pending.then(()=>replace(path,JSON.stringify(next)));
    this.progress=next;
    this.pending=write.catch(()=>{});
    return write;
  }
  async complete() { if (this.receipt) await online("complete",{lease:this.receipt}); }
  async close() { await this.pending; this.progress=undefined; this.path=""; this.receipt=""; }
}
