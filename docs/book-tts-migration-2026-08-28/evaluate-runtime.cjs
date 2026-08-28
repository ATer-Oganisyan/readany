const fs=require('node:fs');
const {createRequire}=require('node:module');
const WebSocket=createRequire('/Users/manaer/.codex/worktrees/5652/Narra2/package.json')('ws');
(async()=>{
 const targets=await fetch('http://127.0.0.1:8082/json/list').then(r=>r.json());
 const target=targets.find(t=>t.appId==='com.mishanaer.readany.dev'); if(!target)throw Error('No worktree dev-client');
 const ws=new WebSocket(target.webSocketDebuggerUrl,{origin:'http://127.0.0.1:8082'});
 await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});
 let sequence=0;const pending=new Map();
 ws.on('message',raw=>{const message=JSON.parse(raw);const task=pending.get(message.id);if(!task)return;pending.delete(message.id);clearTimeout(task.timer);task.resolve(message.result??message.error)});
 const evaluate=expression=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout'))},15000);pending.set(id,{resolve,timer});ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true}}))});
 try {
 const source=fs.readFileSync(process.argv[2],'utf8');
 const start=await evaluate(`globalThis.__narraContractProbe={done:false}; Promise.resolve(${source}).then(value=>{globalThis.__narraContractProbe={done:true,value}},error=>{globalThis.__narraContractProbe={done:true,error:String(error)}}); 'started'`);
 if(start.exceptionDetails)throw Error(JSON.stringify(start.exceptionDetails));
 for(let i=0;i<160;i++){
  await new Promise(r=>setTimeout(r,250));const result=await evaluate('globalThis.__narraContractProbe');
  if(result.result?.value?.done){fs.writeFileSync(process.argv[3],JSON.stringify(result.result.value,null,2));await evaluate('delete globalThis.__narraContractProbe');return}
 }
 throw Error('Async runtime response timed out');
 } finally{ws.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
