/* GamePlan local-first sync.
 * One board, stored in little-dock-local-v2. Discord/Supabase are optional.
 * Explicit linking is required before any project is uploaded or downloaded.
 * Every local edit persists first, including while offline.
 */
(function(){
'use strict';
const $s=q=>document.querySelector(q);
const CFG='gameplan-cloud-config-v1',LINKS='gp-sync-links-v1',BASE='gp-sync-baselines-v1',LAST='gp-sync-backup-import-v1';
const KINDS=['milestones','features','tasks','logs','tags','templates','team','custom_tag_colors'];
const IDS={milestones:'milestone_id',features:'feature_id',tasks:'task_id',logs:'log_id',tags:'tag_id',templates:'template_id',team:'member_id'};
let api=null,user=null,links=read(LINKS,{}),bases=read(BASE,{}),busy=false,loop=null,subscription=null,watched='',ready=false,blocked=false;
const unique=(kind,obj)=>kind==='team'?'member:'+obj.member_id:kind==='custom_tag_colors'?'color:'+obj.color:String(obj[IDS[kind]]||'');
const key=(kind,id)=>kind+'\u0000'+id;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clone=x=>JSON.parse(JSON.stringify(x));
function read(k,fallback){try{return JSON.parse(localStorage.getItem(k)||'null')??fallback}catch{return fallback}}
function store(k,val){localStorage.setItem(k,JSON.stringify(val))}
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
 box.textContent=message;box.classList.toggle('gp-sync-error',error);
}
function counts(pid){
 const snap=projectRows(pid),base=bases[pid]||{};
 return Object.keys(changesSince(base,snap)).length;
}
function refreshStatus(){
 const pid=String(activeProject||''),linked=!!links[pid];
 const pending=linked?counts(pid):0;
 if(!navigator.onLine)status(linked?'Offline · '+pending+' pending':'Offline · local only');
 else if(blocked)status('Sync paused · review backup',true);
 else if(!api||!user)status('Saved on this device');
 else if(!linked)status('Local · not shared');
 else if(busy)status('Syncing…');
 else status(pending?pending+' changes pending':'Cloud synced');
 const share=$s('#gpSyncShare');if(share){share.hidden=!user;share.textContent=linked?'Invite teammates':'Share project';}
 if($s('#gpSyncConnect'))$s('#gpSyncConnect').textContent=user?'Account':'Connect Discord';
}
function persistBaseline(pid,snap){
 bases[pid]=snap;store(BASE,bases);
}
function saveLink(pid,cloudId){
 links[pid]=cloudId;store(LINKS,links);
}
function isEditing(){return !!($s('#back.show')||$s('#gpDialogOverlay')||document.activeElement?.matches('input,textarea,[contenteditable="true"]'))}
async function checkAccount(){
 if(!navigator.onLine)return false;
 const cfg=config();if(!cfg?.url||!cfg?.key)return false;
 if(!api){
  const module=await import('./supabase/gameplan-cloud.js?v=2026.11.05.54');
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
  const cloudId=links[pid],base=bases[pid]||{},before=projectRows(pid);
  const visible=await api.listProjects();
  if(!visible.some(p=>p.id===cloudId))throw Error('Cloud project is not accessible. Local data is safe.');
  const remote=await remoteSnapshot(cloudId,pid);
  const missing=Object.keys(base).filter(k=>base[k]&&!remote[k]&&before[k]);
  if(missing.length)throw Error(missing.length+' cloud items are missing. Local copy preserved; sync paused for review.');
  // First linked sync may not run until a baseline is saved by link/share flow.
  if(!Object.prototype.hasOwnProperty.call(bases,pid))throw Error('Project is not initialized for syncing. Reconnect from Account.');
  mergeRemote(pid,remote,base,before);
  // Save remote baseline BEFORE uploading local pending work so reconnection
  // never interprets teammate edits as ours.
  persistBaseline(pid,remote);
  const local=projectRows(pid),pending=changesSince(remote,local);
  if(!allowWrites||!Object.keys(pending).length){status('Cloud synced');return}
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
    remote[key(item.kind,item.item_id)]={kind:item.kind,item_id:item.item_id,
     payload:{...item.payload,project_id:pid},sort_order:item.sort_order};
   }
   persistBaseline(pid,remote);
  }
  for(const [k,v] of Object.entries(pending)){
   if(v)continue;
   const item=remote[k];if(!item)continue;
   const {error}=await api.client.from('gp_items').delete().eq('project_id',cloudId).eq('kind',item.kind).eq('item_id',item.item_id);
   if(error)throw error;
   delete remote[k];persistBaseline(pid,remote);
  }
  // A project rename is explicit, not a bulk overwrite.
  const cloudProjects=await api.listProjects();
  const cloud=cloudProjects.find(p=>p.id===cloudId);
  const localProject=data.projects.find(p=>String(p.project_id)===String(pid));
  if(cloud&&localProject&&cloud.name!==localProject.project_name){
   await api.renameProject(cloudId,localProject.project_name);
  }
  status('Cloud synced');
 }catch(err){status('Pending changes · '+err.message,true);console.error('[GamePlan sync]',err)}
 finally{busy=false;refreshStatus()}
}
let debounce=null;
function schedule(){
 refreshStatus();
 if(!ready||busy||blocked||!navigator.onLine||!user||!current())return;
 clearTimeout(debounce);
 debounce=setTimeout(()=>void reconcile(String(activeProject)),650);
}
const oldPersist=persist;
persist=function(){oldPersist();schedule()};
const originalHistory=gpHistoryNavigate;
gpHistoryNavigate=function(...args){const result=originalHistory(...args);schedule();return result};
const oldSwitch=gpSwitchProject;
gpSwitchProject=function(pid){oldSwitch(pid);watch();schedule()};
async function watch(){
 const id=current();
 if(id===watched)return;
 subscription?.();subscription=null;watched=id;
 if(!api||!id)return;
 subscription=api.subscribeProject(id,()=>{
  if(isEditing())return;
  clearTimeout(debounce);
  debounce=setTimeout(()=>void reconcile(String(activeProject)),850);
 });
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
    (matching?'<option value="'+e(matching.id)+'">Use existing “'+e(matching.name)+'” (recommended)</option>':'')+
    choice(existing.filter(p=>!matching||p.id!==matching.id))+
    '<option value="">Create new shared project</option></select></label>'
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
   closeModal();await watch();refreshStatus();gpAlert('Project connected. Your local tasks and time logs were uploaded. You can now invite teammates.');
  }catch(err){gpAlert('Could not connect project: '+err.message);btn.disabled=false}
 };
}
async function shareInvite(){
 if(!user)return connect();
 const cloudId=current();if(!cloudId)return shareCurrent();
 const cfg=config();
 const link=location.origin+location.pathname+'?shared='+encodeURIComponent(cloudId)+
  (cfg?.url&&cfg?.key?'&backend='+encodeURIComponent(cfg.url)+'&publishable='+encodeURIComponent(cfg.key):'');
 modal('Share project','<p class="sub">Invite teammates by the email attached to their Discord account. They can open the same GamePlan site and sync with you.</p>'+
  '<label>Project link<input id="gpInviteLink" readonly value="'+e(link)+'"></label>'+
  '<form id="gpInviteForm"><div class="fields"><label class="wide">Teammate Discord email<input name="email" type="email" required></label></div>'+
  '<div class="controls"><button class="button" type="button" id="gpCopyInvite">Copy link</button><button class="button main" type="submit">Invite editor</button></div></form>');
 $s('#gpCopyInvite').onclick=()=>{navigator.clipboard?.writeText(link);gpAlert('Project link copied')};
 $s('#gpInviteForm').onsubmit=async ev=>{
  ev.preventDefault();
  try{await api.inviteByEmail(cloudId,new FormData(ev.currentTarget).get('email'),'editor');closeModal();gpAlert('Invitation saved. Send the project link to your teammate.')}
  catch(err){gpAlert('Invitation failed: '+err.message)}
 };
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
 box.innerHTML='<span id="gpSyncStatus" role="status">Saved on this device</span>'+
  '<button class="button gp-sync-connect" id="gpSyncConnect">Connect Discord</button>'+
  '<button class="button gp-sync-share" id="gpSyncShare" hidden>Share project</button>'+
  '<button class="button gp-sync-now" id="gpSyncNow">↻ Sync</button>';
 area.append(box);
 $s('#gpSyncConnect').onclick=()=>{if(user)modal('Cloud account','<p>Signed in as '+e(accountLabel())+'</p><div class="controls"><button type="button" class="button" id="gpSignOut">Sign out</button><button type="button" class="button main" id="gpAccountDone">Done</button></div>'),
  $s('#gpSignOut').onclick=async()=>{await api.signOut();user=null;closeModal();refreshStatus()},
  $s('#gpAccountDone').onclick=closeModal;
 else void connect()};
 $s('#gpSyncShare').onclick=()=>void shareCurrent();
 $s('#gpSyncNow').onclick=()=>{if(!user){void connect();return}void reconcile(String(activeProject))};
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
