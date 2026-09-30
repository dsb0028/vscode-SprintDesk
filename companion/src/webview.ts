import { randomBytes } from 'node:crypto';

export function html(): string {
  const nonce = randomBytes(24).toString('base64');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; img-src 'none'; connect-src 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);line-height:1.5;padding:18px;max-width:960px;margin:auto}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--vscode-textCodeBlock-background);padding:12px}
button,input{font:inherit;padding:8px;margin:6px 6px 6px 0}button{cursor:pointer}
button:disabled{cursor:default}input{display:block;width:min(95%,600px)}
section{border-top:1px solid var(--vscode-panel-border);padding:12px 0}
:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:3px}
#error{color:var(--vscode-errorForeground)}.warning{border-left:4px solid var(--vscode-editorWarning-foreground);padding:12px}
summary{cursor:pointer;padding:8px 0;font-weight:bold}h2,h3{line-height:1.3}
ol.stepper{display:flex;flex-wrap:wrap;gap:24px;padding-left:24px}.stepper [aria-current]{font-weight:bold}
label{display:block;margin-top:12px}small{display:block}#task-name{overflow-wrap:anywhere}
</style></head><body>
<h1>Independent local review</h1>
<section aria-label="Task and reviewer"><h2 id="task-name">No task loaded</h2><p id="task-id"></p>
<p id="task-status"></p><p id="verification"></p><p id="identity"></p><p id="host"></p></section>
<nav aria-label="Review steps"><ol id="stepper" class="stepper"></ol></nav>
<p id="progress" role="status" aria-live="polite" aria-atomic="true"></p>
<p id="draft" role="status" aria-live="polite"></p>
<p id="error" role="alert" aria-atomic="true" tabindex="-1"></p><p id="error-help"></p>
<section id="controls" aria-label="Review actions"></section>
<section id="evidence" aria-label="Evidence and technical sources"></section>
<script nonce="${nonce}">
const api=acquireVsCodeApi();
let state, inFlight=false, serial=0;
const controls=document.getElementById('controls');
const evidence=document.getElementById('evidence');
const headings={
 enroll:'Set up your local reviewer identity',load:'Choose a task to review',
 criterion:'Review one acceptance criterion',summary:'Check and confirm your review',
 reviewed:'Review submitted — further work required',complete:'Review accepted — ready to complete',
 completionSummary:'Confirm task completion',done:'Task is Done',
 uncertain:'Check whether your last action was accepted',error:'Resolve the issue before continuing',
 revoked:'Local reviewer key revoked'
};
function text(parent,tag,value){const e=document.createElement(tag);e.textContent=value==null?'':String(value);parent.appendChild(e);return e;}
function set(id,value){document.getElementById(id).textContent=value==null?'':String(value);}
function allowed(action){return Array.isArray(state.allowedActions)&&state.allowedActions.includes(action);}
function button(parent,label,action,extra){
 if(!allowed(action))return;
 const rendered=state, version=serial;
 const b=text(parent,'button',label);b.type='button';b.dataset.action=action;b.disabled=!!state.busy||inFlight;
 if(action==='confirm-review'||action==='confirm-complete'){
   b.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.repeat)event.preventDefault();});
 }
 b.onclick=()=>{
   if(state!==rendered||serial!==version||state.busy||inFlight||b.disabled||!allowed(action))return;
   const message={action,token:rendered.token,...(extra?extra():{})};
   inFlight=true;
   for(const control of controls.querySelectorAll('button,input'))control.disabled=true;
   controls.setAttribute('aria-busy','true');
   set('progress','Request sent. Waiting for local verification…');
   api.postMessage(message);
 };
 return b;
}
function input(parent,label,id,value){
 const wrap=text(parent,'label',label);wrap.setAttribute('for',id);
 const e=document.createElement('input');e.id=id;e.type='text';e.value=value||'';
 e.disabled=!!state.busy||inFlight;e.setAttribute('aria-describedby','error error-help');
 e.setAttribute('autocomplete','off');e.setAttribute('spellcheck','false');parent.appendChild(e);return e;
}
function disclosure(parent,id,label){const d=document.createElement('details');d.id=id;parent.appendChild(d);text(d,'summary',label).id=id+'-summary';return d;}
function decisions(parent){
 text(parent,'h3','Criterion decisions');
 const list=text(parent,'ol','');
 state.snapshot.criteria.forEach((criterion,i)=>{
   const item=text(list,'li','');text(item,'p',criterion);
   const result=state.decisions&&state.decisions[i];
   text(item,'p','Decision: '+(result==='met'?'Met':result==='needs work'?'Needs work':'Not yet decided'));
 });
}
function preview(value){const content=String(value||'');return content.length>4000?content.slice(0,4000)+'\\n[Preview truncated; full text is in technical sources below.]':content;}
window.addEventListener('message',event=>{
 const previous=state, active=document.activeElement;
 const samePhase=previous&&previous.phase===event.data.phase&&previous.taskId===event.data.taskId;
 const openIds=Array.from(document.querySelectorAll('details')).filter(d=>d.open).map(d=>d.id);
 const values={};for(const field of controls.querySelectorAll('input'))values[field.id]=field.value;
 const focusId=active&&active.id,focusAction=active&&active.dataset&&active.dataset.action;
 const selection=active&&active.tagName==='INPUT'?[active.selectionStart,active.selectionEnd]:undefined;
 state=event.data;serial++;inFlight=false;controls.replaceChildren();evidence.replaceChildren();
 controls.setAttribute('aria-busy',String(!!state.busy));
 const receiptVerified=state.verification==='verified'&&!state.busy;
 const snapshot=state.snapshot,metadata=snapshot&&snapshot.metadata||{};
 const name=snapshot?String(metadata.code||snapshot.taskId)+' — '+String(metadata.title||'Untitled task'):'No task loaded';
 set('task-name',name);set('task-id',snapshot?'Canonical task ID: '+snapshot.taskId:'Load an exact task code or ID below.');
 set('task-status','Actual task status: '+(state.taskStatus||'Not yet read back'));
 set('verification',state.busy?'Verification: checking local receipts — not yet verified':
   receiptVerified?'Verification: verified against independent local receipts':
   state.verification==='draft'?'Verification: unsigned draft — no approval has been sent':'Verification: unverified — not an approval');
 set('identity',state.identity?'Reviewer: '+state.identity.reviewerName+' (ID: '+state.identity.reviewerId+')':'Reviewer: no local authority enrolled');
 set('host','Workspace: '+(state.workspace||'Not available')+'\\nLocal host: '+(state.host||'Not available'));
 set('progress',state.progress||(state.busy?'Local verification in progress…':'Ready for your next action.'));
 const count=snapshot&&state.decisions?state.decisions.filter(d=>d==='met'||d==='needs work').length:0;
 set('draft',snapshot?count+' of '+snapshot.criteria.length+' criteria decided. '+(state.draftSaved?'Draft saved locally.':'No locally saved draft.'):
   'No review draft loaded.');
 set('error',state.error||'');set('error-help',state.errorHelp||'');
 const stepper=document.getElementById('stepper');stepper.replaceChildren();
 const step=state.phase==='enroll'?0:['load','revoked'].includes(state.phase)?1:state.phase==='criterion'?2:
   ['completionSummary','complete','done'].includes(state.phase)?4:3;
 ['Set up reviewer','Load task','Review criteria','Confirm review','Complete separately'].forEach((label,i)=>{
   const item=text(stepper,'li',label);if(i===step)item.setAttribute('aria-current','step');
 });
 const awaitingVerification=!receiptVerified&&['complete','reviewed','done'].includes(state.phase);
 const heading=text(controls,'h2',awaitingVerification?
   (state.phase==='done'?'Check task completion':'Check review before continuing'):
   headings[state.phase]||'Check local review state');heading.id='workflow-heading';heading.tabIndex=-1;
 if(state.pendingIntent)text(controls,'p','Pending '+(state.pendingIntent==='complete'?'completion':'review')+' receipt. Read back the result before creating another approval.');
 if(state.phase==='enroll'){
   text(controls,'p','In VS Code Running Extensions, personally verify this companion runs on the LOCAL UI host, not SSH, a container, or a workspace host. Confirm desktop VS Code; the remote name alone does not prove placement.');
   const id=input(controls,'Reviewer ID','reviewer-id'),nameInput=input(controls,'Reviewer name','reviewer-name');
   const check=input(controls,'Type LOCAL UI HOST after checking host placement','placement');
   button(controls,'Enroll local reviewer','enroll',()=>({reviewerId:id.value,reviewerName:nameInput.value,placement:check.value}));
 }else{
   if(['load','error','done','reviewed','complete'].includes(state.phase)){
     const id=input(controls,'Exact task code or ID','load-task',state.taskId);
     text(controls,'small','Enter the exact code or full ID. Loading only reads the task; it does not approve or sign it.');
     button(controls,'Load and read back task','load',()=>({taskId:id.value}));
   }
   if(state.phase==='criterion'&&snapshot){
     text(controls,'h3','Criterion '+(state.index+1)+' of '+snapshot.criteria.length);
     text(controls,'pre',snapshot.criteria[state.index]);
     text(controls,'p','Decide only this exact criterion. Decisions remain an unsigned draft until you explicitly confirm the review.');
     button(controls,'Met','met');button(controls,'Needs work','needs work');button(controls,'Needs evidence — pause unsigned draft','needs-evidence');
     button(controls,'Choose workspace evidence files (resets decisions)','evidence');
     button(controls,'Discard draft','discard');
   }
   if(state.phase==='summary'&&snapshot){
     decisions(controls);text(controls,'p','Confirm these exact decisions and evidence. This signs a review only; it never marks the task Done.');
     button(controls,'Confirm and submit review','confirm-review');button(controls,'Discard draft','discard');
   }
   if(state.phase==='complete'){
     text(controls,'p',receiptVerified?
       'Your all-met review has been accepted. The task is not Done yet. Completion requires a separate confirmation.':
       'Review acceptance is not yet independently verified in this view. Wait for verification before treating this task as ready to complete.');
     button(controls,'Review completion for '+name,'complete-summary');
   }
   if(state.phase==='reviewed')text(controls,'p',receiptVerified?
     'Your needs-work review has been submitted and its receipt verified. The criteria are not all met; further work is required. This does not mark the task Done.':
     'Review submission is not yet independently verified in this view. The reported task status above does not establish that the criteria are met.');
   if(state.phase==='done')text(controls,'p',receiptVerified?
     'Completion has been read back. Check the actual task status above.':
     'Completion is not yet independently verified in this view. The reported task status above is not local approval.');
   if(state.phase==='completionSummary'&&snapshot){
     text(controls,'h3','Confirm and mark Done: '+name);
     text(controls,'p','Task ID: '+snapshot.taskId+'. '+(receiptVerified?
       'This separately signs completion for the accepted all-met review and unchanged evidence. It marks this task Done.':
       'Local receipt verification is not yet complete. Do not treat the displayed task status as completion approval.'));
     decisions(controls);button(controls,'Confirm and mark Done','confirm-complete');button(controls,'Not now','cancel');
   }
   const advanced=disclosure(controls,'advanced','Advanced: fresh review, recovery, and key management');
   text(advanced,'p','These controls are separate from review approval. Recovery does not create a new signature.');
   if(['complete','reviewed'].includes(state.phase))button(advanced,'Begin fresh per-criterion review (no inherited decisions)','new-review');
   if(['uncertain','error','revoked'].includes(state.phase)){
     button(advanced,'Read back durable receipt to reconcile','reconcile');button(advanced,'Retry identical durable receipt (no new signature)','retry');
     button(advanced,'Recover original inaccessible identity','unblock');
   }
   if(state.phase==='error'){button(advanced,'Discard changed draft','discard');button(advanced,'Reset blocked task identity','reset');}
   if(['load','error'].includes(state.phase))button(advanced,'Retry public enrollment mirror (same key)','mirror');
   if(state.phase==='revoked')button(advanced,'Recover key with a new human host check','recover');
   else if(state.phase!=='uncertain')button(advanced,'Revoke local key','revoke');
 }
 if(snapshot){
   text(evidence,'h2','Evidence for this exact review');
   const warning=text(evidence,'p',state.handoffWarning||'Generated handoff Markdown is unauthenticated and is never approval.');
   warning.className='warning';warning.setAttribute('role','note');
   text(evidence,'p','Remote approval history is not the local trust root. Source mismatches block signing; read any warning above before proceeding.');
   text(evidence,'h3','Bound evidence preview');
   const files=snapshot.evidence||[];
   if(!files.length)text(evidence,'p','No supplemental workspace evidence files selected. The bound task Markdown remains inspectable in technical sources below.');
   files.slice(0,10).forEach(file=>{text(evidence,'h4',file.path);text(evidence,'pre',preview(file.content));});
   if(files.length>10)text(evidence,'p','Showing the first 10 files; all files are available in the exact snapshot below.');
   const technical=disclosure(evidence,'technical','Technical sources: raw YAML, Markdown, exact snapshot, and local ledger');
   text(technical,'p','All sources are plain text, never executable. Status and approval projections must be checked against local receipts. updatedAt is generated, excluded from the signed digest, and is not an approval timestamp.');
   text(technical,'h3','Current YAML task source');text(technical,'pre',JSON.stringify(state.taskSource,null,2));
   text(technical,'h3','Raw tasks.yml (including remote approval history)');text(technical,'pre',state.rawYaml);
   text(technical,'h3','Raw task Markdown: '+(state.markdownPath||'Not available'));text(technical,'pre',state.rawMarkdown);
   text(technical,'h3','Bound task Markdown (signed snapshot)');text(technical,'pre',snapshot.markdown);
   text(technical,'h3','Full bound workspace evidence');
   files.forEach(file=>{text(technical,'h4',file.path);text(technical,'pre',file.content);});
   text(technical,'h3','Exact bound snapshot');text(technical,'pre',JSON.stringify(snapshot,null,2));
   text(technical,'h3','Independent local ledger');text(technical,'pre',JSON.stringify(state.ledger,null,2));
 }
 if(samePhase){
   for(const id of openIds){const d=document.getElementById(id);if(d)d.open=true;}
   for(const field of controls.querySelectorAll('input'))if(Object.prototype.hasOwnProperty.call(values,field.id))field.value=values[field.id];
 }
 const newError=state.error&&(!previous||previous.error!==state.error);
 if(newError)document.getElementById('error').focus();
 else if(!samePhase||(state.phase==='criterion'&&previous.index!==state.index))heading.focus();
 else{
   const target=focusId&&document.getElementById(focusId)||Array.from(controls.querySelectorAll('button')).find(b=>b.dataset.action===focusAction);
   if(focusAction==='confirm-review'||focusAction==='confirm-complete')heading.focus();
   else if(target&&!target.disabled){
     target.focus();
     if(selection&&typeof target.setSelectionRange==='function'&&selection[0]!==null)target.setSelectionRange(selection[0],selection[1]);
   }
 }
});
api.postMessage({action:'ready'});
</script></body></html>`;
}
