/* GamePlan local-first sync.
 * One board, stored in little-dock-local-v2. Discord/Supabase are optional.
 * Explicit linking is required before any project is uploaded or downloaded.
 * Every local edit persists first, including while offline.
 */
(function(){
'use strict';
const $s=q=>document.querySelector(q);
const CFG='gameplan-cloud-config-v1',LINKS='gp-sync-links-v1',BASE='gp-sync-baselines-v1',LAST='gp-sync-backup-import-v1',PENDING_INVITE='gp-pending-link-invite';
const KINDS=['milestones','features','tasks','logs','tags','templates','team','custom_tag_colors'];
const IDS={milestones:'milestone_id',features:'feature_id',tasks:'task_id',logs:'log_id',tags:'tag_id',templates:'template_id',team:'member_id'};
let api=null,user=null,links=read(LINKS,{}),bases=read(BASE,{}),busy=false,loop=null,subscription=null,watched='',ready=false,blocked=false,inviteAttempted=false;
let lastSyncError=null,lastSyncAt=0,remoteMissingCount=0;
const unique=(kind,obj)=>kind==='team'?'member:'+obj.member_id:kind==='custom_tag_colors'?'color:'+obj.color:String(obj[IDS[kind]]||'');
const key=(kind,id)=>kind+'\u0000'+id;
// PostgreSQL JSONB may reorder object keys without changing record values.
function stable(value){
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
 return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort()
  .map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
}
const equal=(a,b)=>stable(a)===stable(b);
const clone=x=>JSON.parse(JSON.stringify(x));
function read(k,fallback){try{return JSON.parse(localStorage.getItem(k)||'null')??fallback}catch{return fallback}}
function store(k,val){localStorage.setItem(k,JSON.stringify(val))}

// The secret token belongs in the URL fragment, never the HTTP query string.
// Keep it only for this browser tab across the Discord OAuth redirect.
const incomingFragment=new URLSearchParams(location.hash.replace(/^#/,''));
if(incomingFragment.has('invite')){
 const token=incomingFragment.get('invite')||'';
 if(/^[a-f0-9]{64}$/.test(token))sessionStorage.setItem(PENDING_INVITE,token);
 else sessionStorage.removeItem(PENDING_INVITE);
 history.replaceState(null,'',location.pathname+location.search);
}
function config(){return read(CFG,null)}
// The project URL and sb_publishable_ key are public client configuration.
// Include them in invitation links so teammates do not need setup screens.
const incoming=new URLSearchParams(location.search);
if(!config()&&incoming.has('backend')&&incoming.has('publishable')){
 const url=incoming.get('backend'),keyValue=incoming.get('publishable');
 if(/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)&&/^sb_publishable_[\w-]+$/.test(keyValue)){
  store(CFG,{url:url.replace(/\/$/,''),key:keyValue});
 }
}
function current(){return links[String(activeProject)]||''}
function projectRows(pid,source=data){
 const taskIds=new Set((source.tasks||[]).filter(x=>String(x.project_id)===String(pid)).map(x=>String(x.task_id)));
 const out={};
 for(const kind of KINDS){
  const arr=(source[kind]||[]).filter(x=>kind==='logs'?taskIds.has(String(x.task_id)):String(x.project_id)===String(pid));
  for(const [sort_order,obj] of arr.entries()){
   const id=unique(kind,obj);if(!id)continue;
   const payload=clone(obj);
   if(kind==='team'){
    const person=(source.members||[]).find(m=>String(m.member_id)===String(obj.member_id));
    if(person)payload.display_name=person.display_name;
   }
   out[key(kind,id)]={kind,item_id:id,payload,sort_order};
  }
 }
 return out;
}
function remoteRows(items,pid){
 const out={};
 for(const kind of KINDS){
  for(const [i,obj] of (items[kind]||[]).entries()){
   const id=unique(kind,obj);if(!id)continue;
   out[key(kind,id)]={kind,item_id:id,payload:{...clone(obj),project_id:pid},sort_order:i};
  }
 }
 return out;
}
function canonical(record){return record?{kind:record.kind,item_id:record.item_id,payload:record.payload,sort_order:record.sort_order}:null}
function changesSince(base,local){
 const diff={};
 for(const k of new Set([...Object.keys(base),...Object.keys(local)]))
  if(!equal(canonical(base[k]),canonical(local[k])))diff[k]=local[k]||null;
 return diff;
}
function status(message,error=false){
 const box=$s('#gpSyncStatus');
 if(!box)return;
 box.textContent=message;box.title=message;
 box.classList.toggle('gp-sync-error',error);
}
function counts(pid){
 const snap=projectRows(pid),base=bases[pid]||{};
 return Object.keys(changesSince(base,snap)).length;
}
function refreshStatus(){
 const pid=String(activeProject||''),linked=!!links[pid];
 const pending=linked?counts(pid):0;
 if(!navigator.onLine)status(linked?'Offline · '+pending+' pending':'Offline · local only');
 else if(sessionStorage.getItem(PENDING_INVITE)&&!user)status('Invite ready · sign in with Discord');
 else if(blocked)status('Sync paused · review backup',true);
 else if(!api||!user)status('Saved on this device');
 else if(!linked)status('Local · not shared');
 else if(busy)status('Syncing…');
 else if(lastSyncError)status('Sync failed · '+lastSyncError,true);
 else if(remoteMissingCount)status(remoteMissingCount+' items missing remotely · saved locally',true);
 else status(pending?pending+' changes pending':'Cloud synced');
 const share=$s('#gpSyncShare');if(share){share.hidden=!user;share.textContent=linked?'Invite teammates':'Share project';}
 if($s('#gpSyncConnect'))$s('#gpSyncConnect').textContent=user?'Account':sessionStorage.getItem(PENDING_INVITE)?'Join with Discord':'Connect Discord';
}
function persistBaseline(pid,snap){
 bases[pid]=snap;store(BASE,bases);
}
function saveLink(pid,cloudId){
 links[pid]=cloudId;store(LINKS,links);
}
// Focusing a search field is not an edit transaction. Only open dialogs
 // should briefly defer reconciliation of incoming cloud changes.
function isEditing(){return !!($s('#back.show')||$s('#gpDialogOverlay'))}
async function checkAccount(){
 if(!navigator.onLine)return false;
 const cfg=config();if(!cfg?.url||!cfg?.key)return false;
 if(!api){
  const module=await import('./supabase/gameplan-cloud.js?v=2026.11.05.58');
  api=module.createGamePlanCloud({url:cfg.url,publishableKey:cfg.key});
 }
 const {data:result,error}=await api.client.auth.getUser();
 if(error||!result.user){user=null;return false}
 user=result.user;return true;
}
function accountLabel(){return user?.user_metadata?.name||user?.user_metadata?.preferred_username||user?.email||'Signed in'}
function makeLocalRow(record,pid){
 return {...clone(record.payload),project_id:pid};
}
function mergeRemote(pid,remote,base,local){
 const pending=changesSince(base,local),toApply=[];
 for(const k of new Set([...Object.keys(base),...Object.keys(remote)])){
  if(Object.prototype.hasOwnProperty.call(pending,k))continue;
  if(equal(canonical(base[k]),canonical(remote[k])))continue;
  const src=remote[k]||base[k];
  if(src)toApply.push({kind:src.kind,id:src.item_id,record:remote[k]||null});
 }
 if(!toApply.length)return false;
 const draft=clone(data);
 for(const op of toApply){
  const arr=draft[op.kind];if(!Array.isArray(arr))continue;
  const findIndex=arr.findIndex(x=>unique(op.kind,x)===op.id&&(op.kind==='logs'
    ?draft.tasks.some(t=>String(t.task_id)===String(x.task_id)&&String(t.project_id)===String(pid))
    :String(x.project_id)===String(pid)));
  if(op.record){
   const row=makeLocalRow(op.record,pid);
   if(findIndex>=0)arr[findIndex]=row;else arr.push(row);
   if(op.kind==='team'){
    const member=draft.members.find(m=>String(m.member_id)===String(row.member_id));
    if(!member){
     const newMember={member_id:row.member_id,display_name:row.display_name||String(row.member_id),google_email:'',active:'Yes'};
     draft.members.push(newMember);draft.roster.push({...newMember});
    }
   }
   }else if(findIndex>=0){
   // A server-side omission alone is not proof of deletion.
   // Keep the browser record until a deletion can be verified safely.
   continue;
  }
 }
 // Restore task order based on remote sort_order while retaining locally pending rows.
 for(const kind of KINDS){
  const slots=draft[kind];if(!Array.isArray(slots))continue;
  const relevant=slots.filter(x=>kind==='logs'
   ?draft.tasks.some(t=>t.task_id===x.task_id&&String(t.project_id)===String(pid))
   :String(x.project_id)===String(pid));
  const others=slots.filter(x=>!relevant.includes(x));
  relevant.sort((a,b)=>{
   const ka=key(kind,unique(kind,a)),kb=key(kind,unique(kind,b));
   return (remote[ka]?.sort_order??local[ka]?.sort_order??1e9)-(remote[kb]?.sort_order??local[kb]?.sort_order??1e9);
  });
  draft[kind]=[...others,...relevant];
 }
 data=draft;oldPersist();
 render();
 return true;
}
async function remoteSnapshot(cloudId,pid){
 const items=await api.loadProjectItems(cloudId);
 return remoteRows(items,pid);
}
async function reconcile(pid,{allowWrites=true}={}){
 if(!navigator.onLine||!user||!api||!links[pid]||blocked||busy)return;
 if(isEditing())return;
 busy=true;refreshStatus();
 try{
  const cloudId=links[pid],base=bases[pid]||{};
  const visible=await api.listProjects();
  if(!visible.some(p=>p.id===cloudId))throw Error('Cloud project is not accessible. Local data is safe.');
  const remote=await remoteSnapshot(cloudId,pid);
  // First linked sync may not run until a baseline is saved by link/share flow.
  if(!Object.prototype.hasOwnProperty.call(bases,pid))throw Error('Project is not initialized for syncing. Reconnect from Account.');
  // Re-read the local board after network I/O so edits saved during the
  // remote fetch cannot be overwritten by an older pre-request snapshot.
  const liveLocal=projectRows(pid);
  const missing=Object.keys(base).filter(k=>base[k]&&!remote[k]&&liveLocal[k]);
  remoteMissingCount=missing.length;
  // Retain local rows missing remotely without re-uploading them automatically.
  // Other local edits should still be allowed to sync.
  const safeRemote={...remote};
  for(const k of missing)safeRemote[k]=base[k];
  mergeRemote(pid,safeRemote,base,liveLocal);
  persistBaseline(pid,safeRemote);
  const local=projectRows(pid),pending=changesSince(safeRemote,local);
  if(!allowWrites||!Object.keys(pending).length){
   lastSyncError=null;lastSyncAt=Date.now();return;
  }
  const {data:auth,error:authError}=await api.client.auth.getUser();
  if(authError||!auth.user)throw Error('Sign in again to save cloud changes');
  const upserts=Object.values(pending).filter(Boolean).map(row=>({
   project_id:cloudId,kind:row.kind,item_id:row.item_id,
   payload:{...row.payload,project_id:cloudId},sort_order:row.sort_order,
   updated_at:new Date().toISOString(),updated_by:auth.user.id
  }));
  for(let i=0;i<upserts.length;i+=50){
   const {error}=await api.client.from('gp_items').upsert(upserts.slice(i,i+50),{onConflict:'project_id,kind,item_id'});
   if(error)throw error;
   for(const item of upserts.slice(i,i+50)){
    safeRemote[key(item.kind,item.item_id)]={kind:item.kind,item_id:item.item_id,
     payload:{...item.payload,project_id:pid},sort_order:item.sort_order};
   }
   persistBaseline(pid,safeRemote);
  }
  for(const [k,v] of Object.entries(pending)){
   if(v)continue;
   const item=safeRemote[k];if(!item)continue;
   const {error}=await api.client.from('gp_items').delete().eq('project_id',cloudId).eq('kind',item.kind).eq('item_id',item.item_id);
   if(error)throw error;
   delete safeRemote[k];persistBaseline(pid,safeRemote);
  }
  // A project rename is explicit, not a bulk overwrite.
  const cloudProjects=await api.listProjects();
  const cloud=cloudProjects.find(p=>p.id===cloudId);
  const localProject=data.projects.find(p=>String(p.project_id)===String(pid));
  if(cloud&&cloud.owner_id===user.id&&localProject&&cloud.name!==localProject.project_name){
   await api.renameProject(cloudId,localProject.project_name);
  }
  lastSyncError=null;lastSyncAt=Date.now();
 }catch(err){
  lastSyncError=err?.message||String(err);
  console.error('[GamePlan sync]',err);
 }finally{busy=false;refreshStatus()}
}
let debounce=null;
function schedule(){
 refreshStatus();
 if(!ready||blocked||!navigator.onLine||!user||!current())return;
 clearTimeout(debounce);
 debounce=setTimeout(()=>void reconcile(String(activeProject)),650);
}
const oldPersist=persist;
persist=function(){oldPersist();schedule()};
const originalHistory=gpHistoryNavigate;
gpHistoryNavigate=function(...args){const result=originalHistory(...args);schedule();return result};
const oldSwitch=gpSwitchProject;
gpSwitchProject=function(pid){oldSwitch(pid);void watch();schedule()};
const previousCloseModal=closeModal;
closeModal=function(...args){const value=previousCloseModal(...args);schedule();return value};
async function watch(){
 const id=current();
 if(id===watched&&subscription)return;
 remoteMissingCount=0;lastSyncError=null;
 subscription?.();subscription=null;watched='';
 if(!api||!id)return;
 subscription=api.subscribeProject(id,()=>{
  clearTimeout(debounce);
  // When the edit dialog is open, reconcile safely defers until close.
  debounce=setTimeout(()=>void reconcile(String(activeProject)),850);
 });
 watched=id;
}
function downloadBackup(){
 const stamp=new Date().toISOString().slice(0,19).replaceAll(':','-');
 const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download='gameplan-backup-'+stamp+'.json';
 document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
async function setupConfig(){
 const existing=config()||{};
 modal('Cloud connection','<p class="sub">GamePlan saves locally even without a cloud connection. Enter your Supabase public project settings once.</p>'+
  '<form id="gpConnectForm"><div class="fields"><label class="wide">Supabase project URL<input name="url" required value="'+e(existing.url||'')+'"></label>'+
  '<label class="wide">Publishable key<input name="key" required value="'+e(existing.key||'')+'"></label></div>'+
  '<div class="controls"><button class="button" type="button" id="gpConnectCancel">Cancel</button><button class="button main" type="submit">Connect</button></div></form>');
 $s('#gpConnectCancel').onclick=closeModal;
 $s('#gpConnectForm').onsubmit=async ev=>{
  ev.preventDefault();const fields=Object.fromEntries(new FormData(ev.currentTarget));
  if(/sb_secret_|service_role/i.test(fields.key))return gpAlert('Use the public publishable key, not a secret key');
  store(CFG,{url:fields.url.trim().replace(/\/$/,''),key:fields.key.trim()});
  api=null;closeModal();await connect();
 };
}
async function connect(){
 try{
  if(!config()?.url||!config()?.key)return setupConfig();
  if(!navigator.onLine){refreshStatus();return}
  const active=await checkAccount();
  if(!active){
   // Discord redirects through the already-authorized callback bridge.
   // It returns immediately to the same main GamePlan board.
   const desired=new URLSearchParams(location.search).get('shared');
   if(desired)localStorage.setItem('gp-share-request',desired);
   await api.signInWithDiscord();return;
  }
  refreshStatus();await watch();schedule();
 }catch(err){status('Connection error · '+err.message,true);gpAlert('Could not connect cloud: '+err.message)}
}
function choice(list){
 return list.map(p=>'<option value="'+e(p.id)+'">'+e(p.name)+'</option>').join('');
}
async function shareCurrent(){
 if(!user){await connect();if(!user)return}
 if(!navigator.onLine)return gpAlert('You can link a project when you are online. Local editing still works.');
 const pid=String(activeProject),local=data.projects.find(p=>String(p.project_id)===pid);
 if(!local)return;
 if(current())return shareInvite();
 let existing;
 try{existing=await api.listProjects()}catch(err){return gpAlert(err.message)}
 const matching=existing.find(p=>p.name===local.project_name);
 const options=existing.length
  ?'<label class="wide">Cloud destination<select id="gpCloudExisting">'+
    (matching?'<option value="'+e(matching.id)+'">Use existing “'+e(matching.name)+'” (recommended)</option>':'<option value="">Create new shared project (recommended)</option>')+
    choice(existing.filter(p=>!matching||p.id!==matching.id))+
    (matching?'<option value="">Create new shared project</option>':'')+'</select></label>'
  :'';
 modal('Share this project','<p class="sub">Your browser copy stays intact. Connect it to a cloud project to enable team syncing.</p>'+
  '<p class="sub">Before linking an existing project, its cloud items will be backed up in your browser and your local items uploaded without deleting any cloud items.</p>'+
  '<div class="fields">'+options+'</div><div class="controls"><button type="button" class="button" id="gpLinkCancel">Cancel</button>'+
  '<button type="button" class="button main" id="gpLinkConfirm">Copy browser project &amp; enable sync</button></div>');
 $s('#gpLinkCancel').onclick=closeModal;
 $s('#gpLinkConfirm').onclick=async()=>{
  const btn=$s('#gpLinkConfirm');btn.disabled=true;
  try{
   const targetId=$s('#gpCloudExisting')?.value;
   const cloud=targetId?existing.find(p=>p.id===targetId):await api.createProject(local.project_name);
   if(!cloud)throw Error('Cloud project not found');
   const remote=await remoteSnapshot(cloud.id,pid);
   // Explicit upload: never delete unknown remote rows; preserve local tasks,
   // hours, tags, and their IDs. Save the original remote snapshot for recovery.
   const backupKey='gp-cloud-before-link-'+cloud.id;
   store(backupKey,{captured_at:new Date().toISOString(),project:cloud,items:remote});
   const rows=Object.values(projectRows(pid));
   const {data:auth,error:authError}=await api.client.auth.getUser();
   if(authError||!auth.user)throw Error('Session expired');
   for(let i=0;i<rows.length;i+=50){
    const batch=rows.slice(i,i+50).map(row=>({
     project_id:cloud.id,kind:row.kind,item_id:row.item_id,
     payload:{...row.payload,project_id:cloud.id},
     sort_order:row.sort_order,updated_at:new Date().toISOString(),updated_by:auth.user.id
    }));
    const {error}=await api.client.from('gp_items').upsert(batch,{onConflict:'project_id,kind,item_id'});
    if(error)throw error;
   }
   // Baseline includes any remote rows not overwritten. They are added during
   // the next non-destructive sync rather than treated as deletions.
   const combined={...remote,...projectRows(pid)};
   // Keep unrelated items already in the shared project instead of treating
   // them as locally deleted during the first sync.
   mergeRemote(pid,combined,{},projectRows(pid));
   persistBaseline(pid,combined);saveLink(pid,cloud.id);
   closeModal();await watch();refreshStatus();await shareInvite();
  }catch(err){gpAlert('Could not connect project: '+err.message);btn.disabled=false}
 };
}
async function shareInvite(){
 if(!user)return connect();
 const cloudId=current();if(!cloudId)return shareCurrent();
 const cfg=config();
 const buildLink=token=>location.origin+location.pathname+
  (cfg?.url&&cfg?.key?'?backend='+encodeURIComponent(cfg.url)+'&publishable='+encodeURIComponent(cfg.key):'')+
  '#invite='+encodeURIComponent(token);
 const sqlHint='Invite links are not enabled on this Supabase project yet. Run supabase/link-invites.sql in Supabase SQL Editor once.';
 const describeError=err=>/gp_(?:create|list|revoke|accept)_link_invite|PGRST202|42883|Could not find the function|schema cache/i.test(err?.message||'')?sqlHint:(err?.message||String(err));
 modal('Share project',
  '<p class="sub">Create a private invite link. Teammates can open it and join with Discord—no email needed. Anyone with a valid link can join, so only share it with people you trust.</p>'+
  '<form id="gpCreateLinkForm"><div class="fields">'+
  '<label>Access<select name="role"><option value="editor">Editor · can change tasks</option><option value="viewer">Viewer · read only</option></select></label>'+
  '<label>Link expires<select name="days"><option value="7">In 7 days</option><option value="1">In 1 day</option><option value="30">In 30 days</option></select></label>'+
  '</div><div class="controls"><button type="submit" class="button main">+ Generate invite link</button></div></form>'+
  '<div id="gpGeneratedInvite" class="gp-invite-result" hidden><label>Send this link<input id="gpInviteLink" readonly autocomplete="off"></label>'+
  '<div class="controls"><button type="button" class="button main" id="gpCopyInvite">Copy invite link</button></div>'+
  '<p class="sub">This link is shown only now. A link can be used by up to 25 people before it expires or is revoked.</p></div>'+
  '<div id="gpLinkList" class="gp-invite-list"><p class="sub">Loading invite links…</p></div>'+
  '<details class="gp-invite-email"><summary>Invite by email instead (optional)</summary>'+
  '<form id="gpInviteForm"><div class="fields"><label class="wide">Teammate Discord email<input name="email" type="email" required></label></div>'+
  '<div class="controls"><button class="button" type="submit">Invite editor by email</button></div></form></details>');
 const form=$s('#gpCreateLinkForm'),result=$s('#gpGeneratedInvite'),input=$s('#gpInviteLink');
 const historyRoot=$s('#gpLinkList');
 let generated='';
 const refreshLinks=async()=>{
  try{
   const existing=await api.listLinkInvites(cloudId);
   if(!historyRoot.isConnected)return;
   const now=Date.now();
   historyRoot.innerHTML='<h3>Existing invite links</h3>'+
    (existing.length?existing.map(inv=>{
     const active=!inv.revoked_at&&new Date(inv.expires_at).getTime()>now&&Number(inv.use_count)<Number(inv.max_uses);
     const state=inv.revoked_at?'Revoked':new Date(inv.expires_at).getTime()<=now?'Expired':Number(inv.use_count)>=Number(inv.max_uses)?'Used up':'Active';
     return '<div class="gp-invite-row"><div><strong>'+e(inv.invite_role==='viewer'?'Viewer':'Editor')+
      '</strong> <span class="sub">'+e(state)+' · '+e(inv.use_count)+'/'+e(inv.max_uses)+' joined · expires '+
      e(new Date(inv.expires_at).toLocaleDateString())+'</span></div>'+
      (active?'<button type="button" class="button" data-revoke-invite="'+e(inv.invite_id)+'">Revoke</button>':'')+'</div>';
    }).join(''):'<p class="sub">No links created yet.</p>');
  }catch(err){
   if(historyRoot.isConnected)historyRoot.innerHTML='<p class="sub gp-invite-error">'+e(describeError(err))+'</p>';
  }
 };
 form.onsubmit=async ev=>{
  ev.preventDefault();
  const btn=form.querySelector('[type=submit]');btn.disabled=true;
  try{
   const fields=Object.fromEntries(new FormData(form).entries());
   const invite=await api.createLinkInvite(cloudId,fields.role,Number(fields.days));
   generated=buildLink(invite.invite_token);
   input.value=generated;result.hidden=false;
   await refreshLinks();
  }catch(err){gpAlert('Could not generate link: '+describeError(err))}
  finally{btn.disabled=false}
 };
 $s('#gpCopyInvite').onclick=async()=>{
  if(!generated)return;
  try{await navigator.clipboard.writeText(generated);gpAlert('Invite link copied. Send it in Discord!')}
  catch{input.focus();input.select();gpAlert('Copy the selected link to share it.')}
 };
 historyRoot.onclick=async ev=>{
  const button=ev.target.closest('[data-revoke-invite]');if(!button)return;
  if(!await gpConfirm('Revoke this invite link? Anyone who has already joined will keep their membership.',{confirmLabel:'Revoke link',danger:true}))return;
  button.disabled=true;
  try{await api.revokeLinkInvite(button.dataset.revokeInvite);await refreshLinks()}
  catch(err){gpAlert('Could not revoke link: '+describeError(err));button.disabled=false}
 };
 $s('#gpInviteForm').onsubmit=async ev=>{
  ev.preventDefault();
  try{
   await api.inviteByEmail(cloudId,new FormData(ev.currentTarget).get('email'),'editor');
   gpAlert('Email invitation saved. They can use Discord with that email to join.');
  }catch(err){gpAlert('Invitation failed: '+err.message)}
 };
 void refreshLinks();
}
async function joinShared(cloudId){
 if(!user)return;
 const projects=await api.listProjects(),found=projects.find(p=>p.id===cloudId);
 if(!found){gpAlert('This project is not shared with your Discord email yet. Ask the owner to invite you.');return}
 const existing=Object.entries(links).find(([,remote])=>remote===cloudId);
 if(existing){
  activeProject=existing[0];saveProject();render();schedule();return;
 }
 // Fresh browser: download to a new local project without touching any data
 // already saved locally. Do not sync-upload before establishing a baseline.
 const items=await api.loadProjectItems(cloudId);
 const pid='cloud-'+cloudId;
 if(data.projects.some(p=>String(p.project_id)===pid))throw Error('A local project already uses that identifier.');
 const draft=clone(data);
 draft.projects.push({project_id:pid,project_name:found.name,description:'',status:'Active',project_manager_member_id:'penni'});
 const imported=remoteRows(items,pid);
 for(const row of Object.values(imported)){
  draft[row.kind].push({...row.payload,project_id:pid});
 }
 for(const member of items.team||[]){
  if(!draft.members.some(m=>String(m.member_id)===String(member.member_id))){
   const m={member_id:member.member_id,display_name:member.display_name||String(member.member_id),google_email:'',active:'Yes'};
   draft.members.push(m);draft.roster.push({...m});
  }
 }
 data=draft;oldPersist();saveLink(pid,cloudId);persistBaseline(pid,imported);
 activeProject=pid;saveProject();render();watch();refreshStatus();
}
function controls(){
 const area=$s('.gp-header-actions');if(!area)return;
 area.querySelector('.gp-open-cloud')?.remove();
 // Backups/imports remain available, but are recovery tools rather than
 // competing "boards" in the main header.
 const more=document.createElement('details');more.className='gp-more-menu';
 more.innerHTML='<summary class="button" aria-label="More project options">··· More</summary><div class="gp-more-popover"></div>';
 const menu=more.querySelector('.gp-more-popover');
 for(const id of ['export','import','importMilestone','fileInput','milestoneFileInput']){
  const node=$s('#'+id);if(node)menu.append(node);
 }
 area.append(more);
 const box=document.createElement('div');box.className='gp-sync-tools';
 box.innerHTML='<button type="button" id="gpSyncStatus" role="status" title="Open sync details">Saved on this device</button>'+
  '<button class="button gp-sync-connect" id="gpSyncConnect">Connect Discord</button>'+
  '<button class="button gp-sync-share" id="gpSyncShare" hidden>Share project</button>'+
  '<button class="button gp-sync-now" id="gpSyncNow">↻ Sync</button>';
 area.append(box);
 $s('#gpSyncConnect').onclick=()=>{if(user)modal('Cloud account','<p>Signed in as '+e(accountLabel())+'</p><div class="controls"><button type="button" class="button" id="gpSignOut">Sign out</button><button type="button" class="button main" id="gpAccountDone">Done</button></div>'),
  $s('#gpSignOut').onclick=async()=>{await api.signOut();user=null;closeModal();refreshStatus()},
  $s('#gpAccountDone').onclick=closeModal;
 else void connect()};
 $s('#gpSyncShare').onclick=()=>void shareCurrent();
 $s('#gpSyncStatus').onclick=()=>{
  const pid=String(activeProject||''),diff=links[pid]?changesSince(bases[pid]||{},projectRows(pid)):{};
  const countsByKind={};
  for(const change of Object.values(diff)){
   const kind=change?.kind||'deleted items';
   countsByKind[kind]=(countsByKind[kind]||0)+1;
  }
  const count=Object.keys(diff).length;
  const summary=Object.entries(countsByKind).map(([kind,n])=>n+' '+kind).join(', ')||'none';
  const message=lastSyncError?'<p class="gp-sync-error-detail">'+e(lastSyncError)+'</p>':'';
  modal('Cloud synchronization',
   '<p class="sub">'+e(navigator.onLine?'Online':'Offline')+' · '+
    e(user?'Discord connected':'Not connected')+' · '+e(links[pid]?'Shared project':'Browser-only project')+'</p>'+
   '<p><strong>Pending changes:</strong> '+count+'</p><p class="sub">'+e(summary)+'</p>'+
   (lastSyncAt?'<p class="sub">Last successful sync: '+e(new Date(lastSyncAt).toLocaleString())+'</p>':'')+
   (remoteMissingCount?'<p class="sub">Some items appear missing on the server. Your browser copies were kept.</p>':'')+
   message+
   '<div class="controls"><button type="button" class="button" id="gpSyncDownload">Export backup</button>'+
    '<button type="button" class="button main" id="gpSyncRetry">Retry sync</button></div>');
  $s('#gpSyncDownload').onclick=()=>downloadBackup();
  $s('#gpSyncRetry').onclick=()=>{closeModal();void initialize().then(schedule)};
 };
 $s('#gpSyncNow').onclick=async()=>{
  if(blocked){
   const agree=await gpConfirm('A backup was restored. Resume syncing this browser copy? Its differences may update or delete records in the linked cloud project.',{confirmLabel:'Resume syncing'});
   if(!agree)return;
   blocked=false;localStorage.removeItem(LAST);
   refreshStatus();schedule();return;
  }
  if(!user){void connect();return}
  void reconcile(String(activeProject));
 };
 // An existing local export is always available. Import remains a recovery
 // action, not a cloud sync mechanism.
 const cloudLink=$s('.top-actions a[href*="cloud=1"]');cloudLink?.remove();
 const footer=$s('.gp-site-footer p:first-child');if(footer)footer.textContent='Local-first · Your edits are saved on this device and synced when online';
 refreshStatus();
}
const originalImport=$s('#fileInput').onchange;
$s('#fileInput').onchange=async ev=>{
 // Keep an independent recovery copy even when the user elects a full restore.
 // Disable syncing until the user reviews what was imported.
 const file=ev.target.files?.[0];if(!file)return;
 const previous=clone(data);
 blocked=true;refreshStatus();
 await originalImport.call($s('#fileInput'),ev);
 if(!equal(previous,data)){
  store('gp-pre-import-backup-'+Date.now(),previous);
  store(LAST,{created_at:new Date().toISOString(),project_id:activeProject});
  modal('Backup restored locally','<p class="sub">Your restored board is saved on this device. Syncing is paused so it cannot overwrite or delete cloud data automatically.</p>'+
   '<div class="controls"><button class="button" id="gpRestoreReview">Keep offline for now</button>'+
   '<button class="button main" id="gpRestoreResume">Review and resume syncing</button></div>');
  $s('#gpRestoreReview').onclick=closeModal;
  $s('#gpRestoreResume').onclick=async()=>{
   if(!await gpConfirm('Resume syncing the restored board? Changed items, including deletions, may be applied to the linked cloud project.',{confirmLabel:'Resume syncing'}))return;
   blocked=false;localStorage.removeItem(LAST);closeModal();schedule();
  };
 }else{blocked=false}
};
blocked=!!read(LAST,null);
controls();
window.addEventListener('online',()=>{void initialize().then(()=>{schedule();refreshStatus()})});
window.addEventListener('offline',refreshStatus);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){void initialize().then(schedule)}});
setInterval(()=>{if(!document.hidden&&navigator.onLine)void initialize().then(schedule)},25000);
async function initialize(){
 if(!navigator.onLine){refreshStatus();return}
 try{
  const online=await checkAccount();
  if(!online){refreshStatus();return}
  ready=true;
  await watch();
  // Redeem secret links server-side before reading any project data.
  const token=sessionStorage.getItem(PENDING_INVITE);
  if(token&&!inviteAttempted){
   inviteAttempted=true;
   try{
    const inviteCloudId=await api.acceptLinkInvite(token);
    await joinShared(inviteCloudId);
    sessionStorage.removeItem(PENDING_INVITE);
    gpAlert('You joined the shared project! Your changes will sync with your teammates.');
    refreshStatus();return;
   }catch(err){
    const msg=/gp_accept_link_invite|PGRST202|42883|Could not find the function/i.test(err.message||'')
     ?'Invite links require the one-time Supabase link-invites.sql setup.'
     :err.message;
    status('Could not join invitation · '+msg,true);
    gpAlert('Could not join the project: '+msg);
    return;
   }
  }
  const shared=new URLSearchParams(location.search).get('shared')||localStorage.getItem('gp-share-request');
  if(shared)localStorage.removeItem('gp-share-request');
  if(shared&&!Object.values(links).includes(shared)){
   await joinShared(shared);history.replaceState(null,'',location.pathname);return;
  }
  if(current())await reconcile(String(activeProject));
  refreshStatus();
 }catch(err){status('Cloud connection unavailable · changes saved locally',true);console.warn('[GamePlan]',err)}
}
void initialize();
// Optional API for the main page's project management UI.
window.GamePlanSync={connect,shareCurrent,shareInvite,schedule,backup:downloadBackup,
 isLinked:pid=>!!links[String(pid)],status:refreshStatus};
})();
