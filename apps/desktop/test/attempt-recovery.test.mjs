import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {build} from "esbuild";

const bundle=await build({entryPoints:["apps/desktop/src/main/exam-attempt.ts"],bundle:true,write:false,platform:"node",format:"esm",plugins:[{
  name:"isolated-windows-storage",setup(b){
    b.onResolve({filter:/^electron$/},()=>({path:"electron",namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()}"}));
  }
}]});
const {ExamAttempts}=await import("data:text/javascript;base64,"+Buffer.from(bundle.outputFiles[0].text).toString("base64"));

test("a new process restores only the approved package attempt, including completed audio and its original deadline",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"attempt-checkpoint-"));
  const fetchOriginal=globalThis.fetch;
  const used=new Set();
  const startedAt=new Date().toISOString();
  globalThis.fetch=async(_url,request)=>{
    const {packageId}=JSON.parse(request.body);
    const repeated=used.has(packageId);used.add(packageId);
    return Response.json({subject:"subject",receipt:"r".repeat(43),email:"learner@example.com",name:"Learner",startedAt,repeated});
  };
  const config={id:"package-one",studentAccessPolicy:{assignedCandidateIds:[],assignedClassNames:[]},externalDeliveryMode:"lockdown-only"};
  const exam={id:"exam",mode:"app",durationMinutes:45,questions:[{id:"1"},{id:"2"}]};
  const denied=()=>{throw new Error("Invigilator required");};
  try {
    const start=new ExamAttempts(dir);
    await start.open(await start.prepare(config,exam,"token",denied,[],"Class"));
    const progress=structuredClone(start.progress);
    progress.questionIndex=1;progress.session.responses[1].selectedOptionId="answer";
    progress.session.responses[1].flagged=true;progress.session.spokenAnswers={"2":"synthetic-audio"};
    await start.save(progress);await start.close();
    const next=new ExamAttempts(dir);
    await assert.rejects(next.prepare(config,exam,"token",denied,[],"Class"),/Invigilator/);
    await next.open(await next.prepare(config,exam,"token",()=>0,[],"Class"));
    assert.deepEqual(next.progress,JSON.parse(JSON.stringify(progress)));
    await next.close();
    const another={...config,id:"package-two"};
    await next.open(await next.prepare(another,exam,"token",denied,[],"Class"));
    assert.equal(next.progress.questionIndex,0);
    assert.equal(next.progress.session.responses[1].selectedOptionId,undefined);
    assert.equal(next.progress.session.spokenAnswers,undefined);
  } finally {globalThis.fetch=fetchOriginal;await rm(dir,{recursive:true,force:true});}
});
