import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const result = await build({entryPoints:['apps/desktop/src/renderer/lib/linked-timeout.ts'],bundle:true,minify:true,format:'esm',write:false});
const {attemptLinkedTimeout} = await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const url = 'https://docs.google.com/forms/d/e/test/viewform';
const run = async ({assigned=url,current=url,real=current,text='Submit',count=1,disabled=false,action=url.replace('viewform','formResponse')}={}) => {
  let clicks=0;
  const button={innerText:text,getAttribute:()=>null,getClientRects:()=>[{}],matches:()=>disabled,click:()=>clicks++};
  const view={getURL:()=>current,executeJavaScript:async script=>runInNewContext(script,{URL,location:new URL(real),
    document:{forms:[{action,querySelectorAll:()=>Array(count).fill(button)}]}})};
  return [await attemptLinkedTimeout(view,assigned), clicks];
};
test('requests exactly one visible final Submit on the assigned Google Form',async()=>{
  assert.deepEqual(await run(),['attempted',1]);
  assert.deepEqual(await run({assigned:'https://forms.gle/practice',text:'Enviar'}),['attempted',1]);
});
test('timeout never fills blanks, advances sections, clicks an unrelated destination, or follows sign-in',async()=>{
  for(const options of [{text:'Next'},{count:0},{count:2},{disabled:true},{assigned:'https://school.example/quiz'},
    {current:'https://accounts.google.com/Login'},{current:url.replace('/test/','/other/')},{real:url.replace('/test/','/other/')},
    {action:'https://example.org/formResponse'}]) assert.deepEqual(await run(options),['not-attempted',0]);
});
