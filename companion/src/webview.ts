import { randomBytes } from 'node:crypto';

export function html(): string {
  const nonce = randomBytes(24).toString('base64');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; img-src 'none'; connect-src 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">body{font-family:var(--vscode-font-family);padding:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere}button,input{margin:6px;padding:6px}#error{color:var(--vscode-errorForeground)}section{border-top:1px solid;padding:12px 0}</style></head>
<body><h1>Independent local review</h1><pre id="host"></pre><pre id="identity"></pre>
<p id="error" role="alert"></p><section id="controls"></section><section id="evidence"></section>
<script nonce="${nonce}">
const api = acquireVsCodeApi(); let state;
const controls = document.getElementById('controls');
function text(parent, tag, value) { const e=document.createElement(tag); e.textContent=value; parent.appendChild(e); return e; }
function button(label,action,extra) { const b=text(controls,'button',label); b.type='button'; b.onclick=()=>{
  const message={action,token:state.token,...(extra?extra():{})};
  for(const button of controls.querySelectorAll('button')) button.disabled=true;
  api.postMessage(message);
}; return b; }
function input(label) { const wrap=text(controls,'label',label); const e=document.createElement('input'); wrap.appendChild(e); return e; }
window.addEventListener('message', event=>{
 state=event.data; controls.replaceChildren(); document.getElementById('evidence').replaceChildren();
 document.getElementById('host').textContent=state.workspace+'\\n'+state.host;
 document.getElementById('identity').textContent=state.identity?JSON.stringify(state.identity,null,2):'No local authority enrolled';
 document.getElementById('error').textContent=state.error;
 text(controls,'h2',state.phase);
 if(state.phase==='enroll'){
   text(controls,'p','In VS Code Running Extensions, verify this companion runs on the LOCAL UI host, not SSH/container/workspace. Confirm desktop VS Code. Remote name alone does not prove placement.');
   const id=input('Reviewer ID'),name=input('Reviewer name'),check=input('Type LOCAL UI HOST after personally checking host placement');
   button('Enroll / explicitly recover key','enroll',()=>({reviewerId:id.value,reviewerName:name.value,placement:check.value}));
 } else {
   if(['load','error','done','reviewed','complete'].includes(state.phase)) {
     const id=input('Exact task ID'); id.value=state.taskId;
     button('Load / read back task','load',()=>({taskId:id.value}));
   }
   if(state.phase==='criterion') {
     text(controls,'h3','Criterion '+(state.index+1)+' of '+state.snapshot.criteria.length);
     text(controls,'pre',state.snapshot.criteria[state.index]);
     button('Met','met');button('Needs work','needs work');button('Needs evidence (pause draft)','needs-evidence');
     button('Choose actual workspace evidence files (resets decisions)','evidence');button('Discard draft','discard');
   }
   if(state.phase==='summary') {
     text(controls,'pre',JSON.stringify(state.snapshot.criteria.map((criterion,i)=>({criterion,result:state.decisions[i]})),null,2));
     text(controls,'p','Confirm the exact review and displayed evidence. This submits REVIEW only, never completion.');
     button('Confirm signed review','confirm-review');button('Discard draft','discard');
   }
   if(state.phase==='complete') button('Review separate completion summary','complete-summary');
   if(['complete','reviewed'].includes(state.phase)) button('Begin fresh per-criterion review (no inherited decisions)','new-review');
   if(state.phase==='completionSummary') {
     text(controls,'p','Separate completion authorization: confirm this accepted all-met review and unchanged evidence authorize marking this task DONE.');
     text(controls,'pre',JSON.stringify(state.snapshot.criteria,null,2));
     button('Confirm signed completion','confirm-complete');button('Cancel completion','cancel');
   }
   if(['uncertain','error','revoked'].includes(state.phase)) {
     button('Reconcile durable receipt by readback','reconcile');button('Retry identical durable receipt (no new signature)','retry');
     button('Explicitly recover original inaccessible identity','unblock');
   }
   if(state.phase==='error'){button('Discard changed draft','discard');button('Explicitly reset blocked task identity','reset');}
   if(['load','error'].includes(state.phase)) button('Retry public enrollment mirror (same key)','mirror');
   if(state.phase==='revoked')button('Explicit key recovery with new human host check','recover');
   else if(state.phase!=='uncertain')button('Revoke local key','revoke');
 }
 if(state.snapshot){
   const evidence=document.getElementById('evidence');
   text(evidence,'h2','Exact snapshot evidence (plain text; remote content is never executable)');
   text(evidence,'p',state.handoffWarning||'Generated handoff Markdown is unauthenticated, never approval.');
   text(evidence,'h3','Actual current YAML task source');
   text(evidence,'p','Status/workStatus and approval projections are verified against local receipts. updatedAt is generated, excluded from the signed digest, and not an approval timestamp.');
   text(evidence,'pre',JSON.stringify(state.taskSource,null,2));
   text(evidence,'h3','Actual raw tasks.yml (including remote approval history)');
   text(evidence,'p','Top-level approvals are remote history, not the local trust root and not part of task snapshot metadata.');
   text(evidence,'pre',state.rawYaml);
   text(evidence,'h3','Actual task Markdown source: '+state.markdownPath);
   text(evidence,'pre',state.rawMarkdown);
   text(evidence,'pre',JSON.stringify(state.snapshot,null,2));
   text(evidence,'h3','Independent local ledger');text(evidence,'pre',JSON.stringify(state.ledger,null,2));
 }
});
api.postMessage({action:'ready'});
</script></body></html>`;
}
