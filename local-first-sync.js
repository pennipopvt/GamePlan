/* GamePlan local-first sync.
 * One board, stored in little-dock-local-v2. Discord/Supabase are optional.
 * Explicit linking is required before any project is uploaded or downloaded.
 * Every local edit persists first, including while offline.
 */
(function(){
'use strict';
const $s=q=>document.querySelector(q);
const CFG='gameplan-cloud-config-v1',LAST='gp-sync-backup-import-v1',PENDING_INVITE='gp-pending-link-invite',PENDING_APP='gp-pending-app-access-invite';
let PRIVATE_BASE='gp-account-private-baselines-v1',privateBases={};
let LINKS='gp-sync-links-v1',BASE='gp-sync-baselines-v1',DELETED='gp-sync-deleted-v1',NAME_DIRTY='gp-sync-name-dirty-v1',NAME_KNOWN='gp-sync-name-known-v1';
const KINDS=['milestones','features','tasks','logs','tags','templates','team','custom_tag_colors'];
const IDS={milestones:'milestone_id',features:'feature_id',tasks:'task_id',logs:'log_id',tags:'tag_id',templates:'template_id',team:'member_id'};
let api=null,user=null,links=read(LINKS,{}),bases=read(BASE,{}),busy=false,loop=null,subscription=null,watched='',ready=false,blocked=false,inviteAttempted=false;
let lastSyncError=null,lastSyncAt=0,remoteMissingCount=0,deletedIntents=read(DELETED,{}),copyMessageTimer=null;
let activatedUserId='',activating=null,cloudProjectList=[],teamByProject={},teamUpgradeNeeded=false,appAccess={access:true,admin:false,installed:false},preAcceptedProjectId='',preAcceptedProjectToken='';
let nameDirty=read(NAME_DIRTY,{}),knownNames=read(NAME_KNOWN,{}),nameConflictBusy=false;
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
}
if(incomingFragment.has('access')){
 const token=incomingFragment.get('access')||'';
 if(/^[a-f0-9]{64}$/.test(token))sessionStorage.setItem(PENDING_APP,token);
 else sessionStorage.removeItem(PENDING_APP);
}
if(incomingFragment.has('invite')||incomingFragment.has('access'))
 history.replaceState(null,'',location.pathname+location.search);
function config(){
 const saved=read(CFG,null);
 if(saved?.url&&saved?.key)return saved;
 const defaults=window.GamePlanPublicConfig||{};
 const url=String(defaults.url||'').trim().replace(/\/$/,'');
 const key=String(defaults.publishableKey||defaults.key||'').trim();
 if(/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)&&/^sb_publishable_[\w-]+$/.test(key)){
  const entry={url,key};store(CFG,entry);return entry;
 }
 return null;
}
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
 // Private drafts remain ONLY in this account's local browser cache until
 // explicitly published. Filter the whole milestone / feature / task tree,
 // not just the root, so descendants and their logs never leak into gp_items.
 const privateMilestones=new Set((source.milestones||[]).filter(m=>m.__gp_private&&String(m.project_id)===String(pid)).map(m=>String(m.milestone_id)));
 const privateFeatures=new Set((source.features||[]).filter(f=>String(f.project_id)===String(pid)&&(f.__gp_private||privateMilestones.has(String(f.milestone_id)))).map(f=>String(f.feature_id)));
 const privateTasks=new Set((source.tasks||[]).filter(t=>String(t.project_id)===String(pid)&&(t.__gp_private||privateFeatures.has(String(t.feature_id)))).map(t=>String(t.task_id)));
 const taskIds=new Set((source.tasks||[]).filter(t=>String(t.project_id)===String(pid)).map(t=>String(t.task_id)));
 const out={};
 for(const kind of KINDS){
  const arr=(source[kind]||[]).filter(x=>(kind==='logs'?taskIds.has(String(x.task_id)):String(x.project_id)===String(pid))
   &&!(kind==='team'&&x.__gp_account_shadow)
   &&!(kind==='milestones'&&privateMilestones.has(String(x.milestone_id)))
   &&!(kind==='features'&&privateFeatures.has(String(x.feature_id)))
   &&!(kind==='tasks'&&privateTasks.has(String(x.task_id)))
   &&!(kind==='logs'&&privateTasks.has(String(x.task_id))));
  for(const [sort_order,obj] of arr.entries()){
   const id=unique(kind,obj);if(!id)continue;
   // Time logs are linked to a project through their task in local data.
   // Give their snapshot the same project_id as the remote JSONB payload
   // without modifying the actual browser log or its time entry.
   const payload={...clone(obj),project_id:pid};
   if(kind==='team'){
    const person=(source.members||[]).find(m=>String(m.member_id)===String(obj.member_id));
    if(person)payload.display_name=person.display_name;
   }
   out[key(kind,id)]={kind,item_id:id,payload,sort_order};
  }
 }
 return out;
}
// An entirely separate owner-only snapshot. Never put these records in gp_items.
function privateRows(pid,source=data){
 const milestones=new Set((source.milestones||[]).filter(m=>String(m.project_id)===String(pid)&&m.__gp_private).map(m=>String(m.milestone_id)));
 const features=new Set((source.features||[]).filter(f=>String(f.project_id)===String(pid)&&(f.__gp_private||milestones.has(String(f.milestone_id)))).map(f=>String(f.feature_id)));
 const tasks=new Set((source.tasks||[]).filter(t=>String(t.project_id)===String(pid)&&(t.__gp_private||features.has(String(t.feature_id)))).map(t=>String(t.task_id)));
 const result={};
 for(const kind of ['milestones','features','tasks','logs']){
  const arr=(source[kind]||[]).filter(x=>
   kind==='milestones'?milestones.has(String(x.milestone_id)):
   kind==='features'?features.has(String(x.feature_id)):
   kind==='tasks'?tasks.has(String(x.task_id)):
   tasks.has(String(x.task_id)));
  for(const [sort_order,obj] of arr.entries()){
   const id=unique(kind,obj);if(!id)continue;
   result[key(kind,id)]={kind,item_id:id,sort_order,
    payload:{...clone(obj),project_id:pid,__gp_private:true}};
  }
 }
 return result;
}
function savePrivateBaseline(pid,snapshot){
 privateBases[pid]=snapshot;store(PRIVATE_BASE,privateBases);
}
async function reconcilePrivate(pid,cloudId){
 // No fallback to the shared item table: a missing migration must fail closed.
 if(roleFor(pid)!=='owner')return;
 const {data:rows,error}=await api.client.from('gp_private_items')
  .select('kind,item_id,payload,sort_order').eq('project_id',cloudId).eq('user_id',user.id);
 if(error)throw Error('Private draft sync unavailable (install supabase/private-drafts.sql): '+error.message);
 const remote={};
 for(const row of rows||[]){
  if(!['milestones','features','tasks','logs'].includes(row.kind))continue;
  const id=key(row.kind,row.item_id);
  remote[id]={kind:row.kind,item_id:row.item_id,sort_order:row.sort_order,
   payload:{...row.payload,project_id:pid}};
 }
 const base=privateBases[pid]||{},local=privateRows(pid);
 const pending=changesSince(base,local);
 // Receive changes from other devices, but never replace edits made since
 // this browser's last successful sync.
 mergeRemote(pid,remote,base,local);
 const after=privateRows(pid);
 const changed=changesSince(remote,after);
 for(const [id,row] of Object.entries(changed)){
  // Only upload local changes that differ from the last successful baseline.
  if(!Object.prototype.hasOwnProperty.call(pending,id))continue;
  const previous=remote[id]||base[id];
  const next=row||deletedMarker(previous,pid);
  const {error:saveError}=await api.client.from('gp_private_items').upsert({
   user_id:user.id,project_id:cloudId,kind:next.kind,item_id:next.item_id,
   payload:{...next.payload,project_id:cloudId},
   sort_order:next.sort_order,updated_at:new Date().toISOString()
  },{onConflict:'user_id,project_id,kind,item_id'});
  if(saveError)throw saveError;
  remote[id]=next;
 }
 savePrivateBaseline(pid,remote);
}
function remoteRows(items,pid){
 const out={};
 for(const kind of KINDS){
  let livePosition=0;
  for(const obj of (items[kind]||[])){
   const id=unique(kind,obj);if(!id)continue;
   // Tombstones are stored in gp_items but do NOT occupy a visible sort slot.
   // Otherwise deleting a feature would make all subsequent features look
   // reordered and could leave phantom pending changes forever.
   const removed=obj.__gp_deleted===true;
   out[key(kind,id)]={kind,item_id:id,payload:{...clone(obj),project_id:pid},
    sort_order:removed?-1:livePosition++};
  }
 }
 return out;
}
function canonical(record){return record?{kind:record.kind,item_id:record.item_id,payload:record.payload,sort_order:record.sort_order}:null}
function deletedMarker(record,pid){
 const kind=record.kind,id=record.item_id,source=record.payload||{};
 let identity={};
 if(kind==='team')identity={member_id:source.member_id||id.slice('member:'.length)};
 else if(kind==='custom_tag_colors')identity={color:source.color||id.slice('color:'.length)};
 else identity={[IDS[kind]]:source[IDS[kind]]||id};
 return {kind,item_id:id,sort_order:record.sort_order,
  payload:{...identity,project_id:pid,__gp_deleted:true,__gp_deleted_at:new Date().toISOString()}};
}
function changesSince(base,local){
 const diff={};
 for(const k of new Set([...Object.keys(base),...Object.keys(local)])){
  if(base[k]?.payload?.__gp_deleted&&!local[k])continue;
  if(!equal(canonical(base[k]),canonical(local[k])))diff[k]=local[k]||null;
 }
 return diff;
}
function status(message,error=false){
 const box=$s('#gpSyncStatus');
 if(!box)return;
 box.textContent=message;box.title=message;
 box.classList.toggle('gp-sync-error',error);
}
function pendingChanges(pid,base,local){
 const diff=changesSince(base,local);
 for(const k of Object.keys(deletedIntents[pid]||{}))
  if(!local[k]&&!base[k]?.payload?.__gp_deleted)diff[k]=null;
 return diff;
}
function counts(pid){
 const snap=projectRows(pid),base=bases[pid]||{};
 return Object.keys(pendingChanges(pid,base,snap)).length+(nameDirty[pid]?1:0);
}
function refreshStatus(){
 const pid=String(activeProject||''),linked=!!links[pid];
 const pending=linked?counts(pid):0;
 if(!navigator.onLine)status(linked?'Offline · '+pending+' pending':'Offline · local only');
 else if(sessionStorage.getItem(PENDING_APP)&&!user)status('GamePlan invite ready · sign in');
 else if(sessionStorage.getItem(PENDING_INVITE)&&!user)status('Project invite ready · sign in');
 else if(blocked)status('Sync paused · review backup',true);
 else if(!api||!user)status('Saved on this device');
 else if(!linked)status('Local · not shared');
 else if(busy)status('Syncing…');
 else if(lastSyncError)status('Sync failed · '+lastSyncError,true);
 else if(remoteMissingCount)status(remoteMissingCount+' items missing remotely · saved locally',true);
 else status(pending?pending+' changes pending':'Cloud synced');
 const share=$s('#gpSyncShare');if(share){share.hidden=!user;share.textContent=linked?'Invite teammates':'Share project';}
 if($s('#gpSyncConnect'))$s('#gpSyncConnect').textContent=user?accountDisplayName():sessionStorage.getItem(PENDING_APP)||sessionStorage.getItem(PENDING_INVITE)?'Accept invitation':'Sign in';
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
 const cfg=config();if(!cfg?.url||!cfg?.key)return false;
 if(!api){
  const module=await import('./supabase/gameplan-cloud.js?v=2026.11.07.78');
  api=module.createGamePlanCloud({url:cfg.url,publishableKey:cfg.key});
 }
 if(!navigator.onLine){
  const session=await api.getSession().catch(()=>null);
  user=session?.user||null;return !!user;
 }
 const {data:result,error}=await api.client.auth.getUser();
 if(error||!result.user){user=null;return false}
 user=result.user;return true;
}
function accountLabel(){return user?.user_metadata?.name||user?.user_metadata?.preferred_username||user?.email||'Signed in'}

function accountDisplayName(){
 return user?.user_metadata?.preferred_username||user?.user_metadata?.global_name||
 user?.user_metadata?.name||user?.user_metadata?.full_name||
 user?.email?.split('@')[0]||'Account';
}
function accountMemberId(id=user?.id){return 'account:'+id}
function roleFor(pid=activeProject){
 if(!user||!activatedUserId)return 'none';
 if(!links[String(pid)])return 'owner'; // a local draft belongs to its signed-in account
 const cloudId=links[String(pid)];
 if(cloudProjectList.find(x=>x.id===cloudId)?.owner_id===user.id)return 'owner';
 return teamByProject[String(pid)]?.find(x=>x.member_user_id===user.id)?.member_role||'viewer';
}
function ensureAccountMember(memberId,name){
 let person=data.members.find(m=>String(m.member_id)===String(memberId));
 if(!person){
  person={member_id:memberId,display_name:name,google_email:'',active:'Yes'};
  data.members.push(person);data.roster.push({...person});
 }else if(name){person.display_name=name;const roster=data.roster.find(m=>m.member_id===memberId);if(roster)roster.display_name=name}
 return person;
}
function hasMeaningfulLegacyBoard(board){
 if(!board||!Array.isArray(board.projects))return false;
 if((board.tasks?.length||0)||(board.logs?.length||0)||(board.features?.length||0)||
    (board.milestones?.length||0)||(board.tags?.length||0))return true;
 return board.projects.some(p=>p.project_name!=='Fishing Game — Proof of Concept');
}
async function activateAccount(){
 if(!user)return false;
 if(activatedUserId===user.id)return true;
 if(activating)return activating;
 activating=(async()=>{
  const id=user.id;
  const accountKey='gp-account-board-v1:'+id;
  const projectKey='gp-account-active-v1:'+id;
  const linksKey='gp-account-links-v1:'+id;
  const baseKey='gp-account-baselines-v1:'+id;
  const deletedKey='gp-account-deletes-v1:'+id;
   PRIVATE_BASE='gp-account-private-baselines-v1:'+id;
  const nameDirtyKey='gp-account-name-dirty-v1:'+id;
  const knownNameKey='gp-account-name-known-v1:'+id;
  let saved=read(accountKey,null);
  let choseLegacy=false;
  if(!saved){
   const legacy=read('little-dock-local-v2',null);
   const meaningful=hasMeaningfulLegacyBoard(legacy);
   let decision='empty';
   if(meaningful){
    decision=await window.GamePlanAccounts?.requestMigration?.({
     projectCount:legacy.projects?.length||0,
     taskCount:legacy.tasks?.length||0,
     logCount:legacy.logs?.length||0
    })||'empty';
   }
   choseLegacy=decision==='copy';
   saved=choseLegacy?clone(legacy):seedData();
   // Always retain the legacy key as an untouched recovery snapshot.
   store(accountKey,saved);
   if(choseLegacy){
    const visible=await api.listProjects().catch(()=>[]);
    const access=new Set(visible.map(p=>p.id));
    const oldLinks=read('gp-sync-links-v1',{});
    const migratedLinks=Object.fromEntries(Object.entries(oldLinks)
     .filter(([localId,cloudId])=>saved.projects.some(p=>String(p.project_id)===localId)&&access.has(cloudId)));
    store(linksKey,migratedLinks);
    const oldBases=read('gp-sync-baselines-v1',{});
    store(baseKey,Object.fromEntries(Object.entries(oldBases).filter(([pid])=>!!migratedLinks[pid])));
    const oldDeletes=read('gp-sync-deleted-v1',{});
    store(deletedKey,Object.fromEntries(Object.entries(oldDeletes).filter(([pid])=>!!migratedLinks[pid])));
    const oldPid=localStorage.getItem('little-dock-local-project');
    if(oldPid&&saved.projects.some(p=>String(p.project_id)===oldPid))localStorage.setItem(projectKey,oldPid);
   }
  }
  LOCAL_KEY=accountKey;PROJECT_KEY=projectKey;
  LINKS=linksKey;BASE=baseKey;DELETED=deletedKey;NAME_DIRTY=nameDirtyKey;NAME_KNOWN=knownNameKey;
  links=read(LINKS,{});bases=read(BASE,{});privateBases=read(PRIVATE_BASE,{});deletedIntents=read(DELETED,{});
  nameDirty=read(NAME_DIRTY,{});knownNames=read(NAME_KNOWN,{});
  data=loadLocal();
  gpMyOnly=false;
  const cloudCacheKey='gp-account-cloud-projects-v1:'+id;
  cloudProjectList=navigator.onLine
   ?await api.listProjects().catch(()=>read(cloudCacheKey,[]))
   :read(cloudCacheKey,[]);
  if(navigator.onLine&&cloudProjectList.length)store(cloudCacheKey,cloudProjectList);
  teamByProject=read('gp-account-teams-v1:'+id,{});
  for(const [pid,rows] of Object.entries(teamByProject))
   window.GamePlanAvatars?.setTeam?.(pid,rows,user);
  const owned=Object.entries(links).some(([localId,cloudId])=>
   cloudProjectList.some(p=>p.id===cloudId&&p.owner_id===id)&&
   String(data.projects.find(p=>String(p.project_id)===localId)?.project_manager_member_id)===String(data.me?.member_id));
  const legacyId=owned&&data.me?.member_id?data.me.member_id:accountMemberId(id);
  const display=accountDisplayName();
  data.me={member_id:legacyId,display_name:display};
  data.email=user.email||'';
  ensureAccountMember(legacyId,display);
  const old=readProject();
  activeProject=data.projects.some(p=>String(p.project_id)===String(old))?old:data.projects[0]?.project_id||'';
  saveProject();
  // Save ONLY inside the new per-user workspace. Original old board remains intact.
  oldPersist();
  activatedUserId=id;ready=true;lastSyncError=null;
  if(data.projects.length){
   $s('#mainApp').hidden=false;
   window.GamePlanAccounts?.hideEmpty?.();
   render();
  }else window.GamePlanAccounts?.emptyWorkspace?.();
  window.GamePlanAccounts?.onAuthenticated?.(user);
  return true;
 })().finally(()=>{activating=null});
 return activating;
}
async function syncProjectName(pid,cloudProjects){
 if(!user||!api||!links[String(pid)])return;
 const cloud=cloudProjects.find(p=>p.id===links[String(pid)]);
 const local=data.projects.find(p=>String(p.project_id)===String(pid));
 if(!cloud||!local)return;
 const owner=cloud.owner_id===user.id;
 const desired=nameDirty[pid];
 if(desired&&owner){
  // Project title sync works even when no tasks have been changed.
  if(cloud.name!==desired){
   const changed=await api.renameProject(cloud.id,desired);
   cloud.name=changed?.name||desired;
  }
  if(nameDirty[pid]===desired){delete nameDirty[pid];store(NAME_DIRTY,nameDirty)}
  knownNames[pid]=cloud.name;store(NAME_KNOWN,knownNames);
  return;
 }
 if(local.project_name===cloud.name){
  if(nameDirty[pid]){delete nameDirty[pid];store(NAME_DIRTY,nameDirty)}
  if(knownNames[pid]!==cloud.name){knownNames[pid]=cloud.name;store(NAME_KNOWN,knownNames)}
  return;
 }
 if(owner&&!Object.prototype.hasOwnProperty.call(knownNames,pid)&&!nameConflictBusy){
  // Older versions saved project renames only locally. Resolve once safely.
  nameConflictBusy=true;
  try{
   const useLocal=await gpConfirm('Two project names were found.\n\nOn this device: “'+local.project_name+'”\nIn the cloud: “'+cloud.name+'”\n\nUse this device’s name for everyone? Choose Cancel to keep the cloud name.',{confirmLabel:'Use device name'});
   if(useLocal){
    nameDirty[pid]=local.project_name;store(NAME_DIRTY,nameDirty);
    const renamed=await api.renameProject(cloud.id,local.project_name);
    cloud.name=renamed?.name||local.project_name;
    delete nameDirty[pid];store(NAME_DIRTY,nameDirty);
   }else{
    local.project_name=cloud.name;oldPersist();
    if(String(activeProject)===String(pid))render();
   }
   knownNames[pid]=cloud.name;store(NAME_KNOWN,knownNames);
  }finally{nameConflictBusy=false}
  return;
 }
 if(nameDirty[pid]&&!owner){delete nameDirty[pid];store(NAME_DIRTY,nameDirty)}
 local.project_name=cloud.name;knownNames[pid]=cloud.name;
 store(NAME_KNOWN,knownNames);oldPersist();
 if(String(activeProject)===String(pid))render();
}
async function refreshProjectList(){
 if(!api||!user)return;
 cloudProjectList=await api.listProjects();
 if(user)store('gp-account-cloud-projects-v1:'+user.id,cloudProjectList);
 for(const pid of Object.keys(links))await syncProjectName(pid,cloudProjectList);
 // Import projects that this authenticated account can read and does not
 // already have locally. No existing project or local cache is replaced.
 for(const project of cloudProjectList){
  if(Object.values(links).includes(project.id))continue;
  // A locally migrated board with the same title may contain newer offline
  // work. Don't create a duplicate or link it automatically.
  const sameName=data.projects.some(p=>p.project_name===project.name);
  if(sameName)continue;
  await joinShared(project.id);
 }
 if(data.projects.length){
  window.GamePlanAccounts?.hideEmpty?.();
  $s('#mainApp').hidden=false;
 }else window.GamePlanAccounts?.emptyWorkspace?.();
}
async function reloadTeam(pid=activeProject){
 if(!user||!links[String(pid)]||!api)return [];
 const cloudId=links[String(pid)];
 let rows=[],upgrade=false;
 try{rows=await api.projectTeam(cloudId)}
 catch(err){
  if(!/gp_project_team|PGRST202|42883|Could not find the function|schema cache/i.test(err.message||''))throw err;
  upgrade=true;
  const raw=await api.listMembers(cloudId);
  rows=raw.map(m=>({
   member_user_id:m.user_id,member_role:m.role,joined_at:m.joined_at,
   account_name:m.user_id===user.id?accountDisplayName():'Teammate',
   display_name:m.user_id===user.id?accountDisplayName():'Teammate',
   legacy_member_id:null
  }));
 }
 if(!upgrade&&rows.length&&cloudProjectList.find(p=>p.id===cloudId)?.owner_id===user.id){
  // Own old PM assignments can safely be associated with the actual owner.
  const owner=rows.find(x=>x.member_user_id===user.id);
  const original=data.projects.find(x=>x.project_id===pid)?.project_manager_member_id;
  if(owner&&!owner.legacy_member_id&&original&&data.members.some(m=>m.member_id===original)){
   try{
    await api.setTeamMember(cloudId,user.id,owner.display_name,original);
    rows=await api.projectTeam(cloudId);
   }catch(err){console.warn('[GamePlan owner legacy link]',err)}
  }
 }
 // Public Discord avatar URLs are an optional, separately authorized RPC.
 // Older Supabase workspaces still render colored initials without this upgrade.
 const prior=teamByProject[String(pid)]||[];
 const previousURLs=new Map(prior.map(row=>[String(row.member_user_id),row.avatar_url||'']));
 const avatarURLs=new Map();
 try{
  const avatars=await api.projectTeamAvatars(cloudId);
  for(const avatar of avatars||[])if(avatar?.member_user_id&&avatar.avatar_url)
   avatarURLs.set(String(avatar.member_user_id),String(avatar.avatar_url));
 }catch(err){
  if(!/gp_project_team_avatars|PGRST202|42883|Could not find the function|schema cache/i.test(err.message||''))
   console.warn('[GamePlan optional avatars]',err);
 }
 rows=rows.map(row=>{
  const own=String(row.member_user_id)===String(user.id)?user.user_metadata?.avatar_url||user.user_metadata?.picture||'':'';
  return {...row,avatar_url:avatarURLs.get(String(row.member_user_id))||own||previousURLs.get(String(row.member_user_id))||null};
 });
 window.GamePlanAvatars?.setTeam?.(pid,rows,user);
 const mappingChanged=JSON.stringify(prior.map(m=>[m.member_user_id,m.legacy_member_id,m.member_role,m.display_name,m.avatar_url]))!==JSON.stringify(rows.map(m=>[m.member_user_id,m.legacy_member_id,m.member_role,m.display_name,m.avatar_url]));
 teamByProject[String(pid)]=rows;
 store('gp-account-teams-v1:'+user.id,teamByProject);
 const shadows=data.team.filter(t=>t.project_id===pid&&t.__gp_account_shadow);
 data.team=data.team.filter(t=>!(t.project_id===pid&&t.__gp_account_shadow));
 for(const m of rows){
  const preferred=m.legacy_member_id||
   (m.member_role==='owner'?data.projects.find(p=>p.project_id===pid)?.project_manager_member_id:'')||
   accountMemberId(m.member_user_id);
  ensureAccountMember(preferred,m.display_name||m.account_name||'Teammate');
  if(!data.team.some(t=>t.project_id===pid&&String(t.member_id)===String(preferred))){
   data.team.push({project_id:pid,member_id:preferred,
    linked_user_id:m.member_user_id,project_role:m.member_role==='owner'?'Owner':m.member_role==='editor'?'Editor':'Viewer',
    membership_status:'Active',discipline:'',__gp_account_shadow:true});
  }
 }
 // Team/account shadows only affect this browser's UI and aren't uploaded.
 oldPersist();
 window.GamePlanAccounts?.setTeam?.(rows,roleFor(pid),upgrade);
 if(gpPage==='team')window.GamePlanAccounts?.renderTeamPage?.();
 else if(gpPage==='board'&&mappingChanged&&!isEditing()&&String(pid)===String(activeProject))render();
 if(roleFor(pid)==='viewer')document.body.classList.add('gp-readonly');
 else document.body.classList.remove('gp-readonly');
 return rows;
}
async function createAuthenticatedProject(name){
 if(!user)throw Error('Please sign in first.');
 if(!navigator.onLine)throw Error('Connect to the internet to create a shared project.');
 const created=await api.createProject(name);
 const pid='cloud-'+created.id,memberId=data.me.member_id;
 data.projects.push({project_id:pid,project_name:created.name,description:'',
  status:'Active',project_manager_member_id:memberId});
 knownNames[pid]=created.name;store(NAME_KNOWN,knownNames);
 data.team.push({project_id:pid,member_id:memberId,project_role:'Owner',
  membership_status:'Active',discipline:'',linked_user_id:user.id,__gp_account_shadow:true});
 cloudProjectList.push(created);saveLink(pid,created.id);persistBaseline(pid,{});
 activeProject=pid;saveProject();oldPersist();
 window.GamePlanAccounts?.hideEmpty?.();$s('#mainApp').hidden=false;
 render();await watch();await reloadTeam(pid);
 return created;
}
window.GamePlanAuth={canEdit:pid=>user&&activatedUserId===user.id&&['owner','editor'].includes(roleFor(pid)),
 roleFor:pid=>roleFor(pid),user:()=>user};

function makeLocalRow(record,pid){
 return {...clone(record.payload),project_id:pid};
}
function mergeRemote(pid,remote,base,local,confirmedLegacyDeletes=new Set()){
 const pending=pendingChanges(pid,base,local),toApply=[];
 for(const k of new Set([...Object.keys(base),...Object.keys(remote)])){
  if(Object.prototype.hasOwnProperty.call(pending,k))continue;
  if(equal(canonical(base[k]),canonical(remote[k])))continue;
  const src=remote[k]||base[k];
  if(src)toApply.push({kind:src.kind,id:src.item_id,
   record:remote[k]?.payload?.__gp_deleted?null:(remote[k]||null),
   explicitDelete:!!remote[k]?.payload?.__gp_deleted||confirmedLegacyDeletes.has(k)});
 }
 if(!toApply.length)return false;
 const draft=clone(data);
 for(const op of toApply){
  const arr=draft[op.kind];if(!Array.isArray(arr))continue;
  const findIndex=arr.findIndex(x=>unique(op.kind,x)===op.id&&(op.kind==='logs'
    ?true:String(x.project_id)===String(pid)));
  if(op.record){
   const row=makeLocalRow(op.record,pid);
   if(findIndex>=0)arr[findIndex]=row;else arr.push(row);
   if(op.kind==='team'){
    const member=draft.members.find(m=>String(m.member_id)===String(row.member_id));
    if(!member){
     const newMember={member_id:row.member_id,display_name:row.display_name||String(row.member_id),google_email:'',active:'Yes'};
     draft.members.push(newMember);draft.roster.push({...newMember});
    }else if(row.display_name&&member.display_name!==row.display_name){
     member.display_name=row.display_name;
     const roster=draft.roster.find(m=>String(m.member_id)===String(row.member_id));
     if(roster)roster.display_name=row.display_name;
    }
   }
   }else if(findIndex>=0){
   // A tombstone is a confirmed intentional deletion, unlike a missing row.
   if(op.explicitDelete)arr.splice(findIndex,1);
   else continue;
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
  await syncProjectName(pid,visible);
  await reconcilePrivate(pid,cloudId);
   const remote=await remoteSnapshot(cloudId,pid);
  // First linked sync may not run until a baseline is saved by link/share flow.
  if(!Object.prototype.hasOwnProperty.call(bases,pid))throw Error('Project is not initialized for syncing. Reconnect from Account.');
  // Re-read the local board after network I/O so edits saved during the
  // remote fetch cannot be overwritten by an older pre-request snapshot.
  const liveLocal=projectRows(pid);
  // Clear out locally queued deletes that are already confirmed by a
  // remote tombstone (another editor may have deleted the same item).
  let confirmedDeletes=false;
  for(const k of Object.keys(deletedIntents[pid]||{})){
   if(remote[k]?.payload?.__gp_deleted){
    delete deletedIntents[pid][k];confirmedDeletes=true;
   }
  }
  if(confirmedDeletes)store(DELETED,deletedIntents);
  const missing=Object.keys(base).filter(k=>base[k]&&!remote[k]&&liveLocal[k]);
  const confirmedLegacyDeletes=new Set();
  // Compatibility with older GamePlan versions that hard-deleted records.
  // Verify each missing item with a separate query before considering it
  // an intentional deletion; NEVER infer bulk deletions from an empty feed.
  const remoteCount=Object.keys(remote).length;
  const safeRead=remoteCount>=5&&remoteCount>=Math.ceil(Object.keys(base).length*0.65);
  const smallGap=missing.length>0&&missing.length<=Math.max(3,Math.floor(Object.keys(base).length*0.15));
  if(safeRead&&smallGap){
   for(const k of missing){
    // Preserve any local edit newer than this browser's previous baseline.
    if(!equal(canonical(base[k]),canonical(liveLocal[k])))continue;
    const row=base[k];
    const {data:found,error:verifyError}=await api.client.from('gp_items')
     .select('item_id').eq('project_id',cloudId)
     .eq('kind',row.kind).eq('item_id',row.item_id).limit(1);
    if(verifyError)throw verifyError;
    if(Array.isArray(found)&&found.length===0)confirmedLegacyDeletes.add(k);
   }
  }
  if(confirmedLegacyDeletes.size){
   // Keep a recovery copy of records removed through legacy reconciliation.
   const recovered={};
   for(const k of confirmedLegacyDeletes)recovered[k]=liveLocal[k];
   store('gp-legacy-delete-backup-'+Date.now(),{project_id:pid,items:recovered});
  }
  remoteMissingCount=missing.length-confirmedLegacyDeletes.size;
  const safeRemote={...remote};
  for(const k of missing)if(!confirmedLegacyDeletes.has(k))safeRemote[k]=base[k];
  mergeRemote(pid,safeRemote,base,liveLocal,confirmedLegacyDeletes);
  persistBaseline(pid,safeRemote);
  const local=projectRows(pid),pending=pendingChanges(pid,safeRemote,local);
  // A row absent on the server but changed locally is a potential conflict,
  // not permission to resurrect the deleted feature. Keep its browser copy,
  // omit it from automatic uploads and display the unresolved conflict status.
  for(const k of missing)if(!confirmedLegacyDeletes.has(k))delete pending[k];
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
   const batch=upserts.slice(i,i+50);
   const {data:saved,error}=await api.client.from('gp_items')
    .upsert(batch,{onConflict:'project_id,kind,item_id'}).select('kind,item_id');
   if(error)throw error;
   if(!Array.isArray(saved)||saved.length!==batch.length)
    throw Error('Supabase did not confirm saving all '+batch.length+' changed items. The browser copy is safe.');
   for(const item of batch){
    safeRemote[key(item.kind,item.item_id)]={kind:item.kind,item_id:item.item_id,
     payload:{...item.payload,project_id:pid},sort_order:item.sort_order};
   }
   persistBaseline(pid,safeRemote);
  }
  // Explicit deletion markers are ordinary upserts, not empty server rows.
  // They survive reconnects and tell every teammate the item was removed.
  for(const [k,v] of Object.entries(pending)){
   if(v)continue;
   const source=safeRemote[k]||deletedIntents[pid]?.[k];
   if(!source)continue;
   const mark=deletedMarker(source,pid);
   const row={project_id:cloudId,kind:mark.kind,item_id:mark.item_id,
    payload:{...mark.payload,project_id:cloudId},sort_order:mark.sort_order,
    updated_at:new Date().toISOString(),updated_by:auth.user.id};
   const {data:saved,error}=await api.client.from('gp_items')
    .upsert(row,{onConflict:'project_id,kind,item_id'}).select('kind,item_id');
   if(error)throw error;
   if(!Array.isArray(saved)||saved.length!==1)
    throw Error('Cloud did not confirm the deletion of '+mark.kind+'. The deletion is still saved on this device.');
   safeRemote[k]=mark;persistBaseline(pid,safeRemote);
   if(deletedIntents[pid]?.[k]){
    delete deletedIntents[pid][k];store(DELETED,deletedIntents);
   }
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
persist=function(){
 if(user&&activatedUserId&&current()&&roleFor(activeProject)==='viewer'){
  data=loadLocal();render();
  throw Error('Viewer access is read-only. Ask the owner for Editor permission.');
 }
 // Capture user-initiated removals BEFORE overwriting the previous browser
 // snapshot. A deletion of a teammate-created item is retained even if its
 // first realtime update hasn't yet reached our saved cloud baseline.
 const before=read(LOCAL_KEY,null);
 if(before){
  for(const pid of Object.keys(links)){
   const previous=before.projects?.find(p=>String(p.project_id)===String(pid))?.project_name;
   const current=data.projects.find(p=>String(p.project_id)===String(pid))?.project_name;
   if(previous!==undefined&&current!==undefined&&previous!==current){nameDirty[pid]=current;store(NAME_DIRTY,nameDirty)}
  }
  for(const pid of Object.keys(links)){
   const previous=projectRows(pid,before),now=projectRows(pid,data);
   const intents=deletedIntents[pid]||(deletedIntents[pid]={});
   for(const [k,item] of Object.entries(previous))
    if(!now[k])intents[k]=item;
   for(const k of Object.keys(now))delete intents[k];
  }
  store(DELETED,deletedIntents);
 }
 oldPersist();schedule();
};
const originalHistory=gpHistoryNavigate;
gpHistoryNavigate=function(...args){
 if(user&&activatedUserId&&current()&&roleFor(activeProject)==='viewer'){
  gpAlert('Viewer access is read-only. Ask the owner for Editor permission.');return;
 }
 const result=originalHistory(...args);schedule();return result;
};
const oldSwitch=gpSwitchProject;
gpSwitchProject=function(pid){oldSwitch(pid);void watch();void reloadTeam(pid);schedule()};
const originalLocalRpc=rpc;
rpc=async function(op,p={}){
 if(!user||activatedUserId!==user.id)throw Error('Please sign in to use GamePlan.');
 if(op==='createProject'){
  await createAuthenticatedProject(p.name);return {ok:true};
 }
 if(current()&&roleFor(activeProject)==='viewer')
  throw Error('This project is view-only. Ask the owner for Editor access.');
 if(current()&&['addMember','updateMember','removeMember'].includes(op))
  throw Error('Team access is managed through authenticated invitations and the Team tab.');
 return originalLocalRpc(op,p);
};
// Existing project delete button was local-only. Never let it hide a live
// shared project without deleting the server record and its memberships.
const previousRenameProject=gpRenameProjectInline;
gpRenameProjectInline=function(...args){
 if(current()&&roleFor(activeProject)!=='owner'){
  const title=$s('#gpProjectTitle');
  if(title)title.value=data.projects.find(p=>p.project_id===activeProject)?.project_name||'';
  gpAlert('Only the project owner can rename the shared project.');return;
 }
 return previousRenameProject(...args);
};
const previousSettings=gpSettings;
gpSettings=function(...args){
 const value=previousSettings(...args);
 if(current()&&roleFor(activeProject)!=='owner'){
  for(const id of ['gpRename','gpDeleteProject']){
   const btn=$s('#'+id);if(btn){btn.disabled=true;btn.title='Only the owner can do this'}
  }
 }
 return value;
};
// Deletion is now handled by gpDeleteProject, which confirms and backs up the
// local board, deletes the cloud project first, then clears its browser copy.
// Never clear the local link merely because a network request was started.
async function deleteSharedProject(pid){
 if(!user||!api||!navigator.onLine)throw Error('Sign in and connect to the internet first.');
 if(roleFor(pid)!=='owner')throw Error('Only the project owner can permanently delete it.');
 const cloudId=links[String(pid)];
 if(!cloudId)throw Error('This project has no cloud connection.');
 const {data:deleted,error}=await api.client.from('gp_projects')
  .delete().eq('id',cloudId).eq('owner_id',user.id).select('id');
 if(error)throw error;
 if(!Array.isArray(deleted)||deleted.length!==1||String(deleted[0]?.id)!==String(cloudId))
  throw Error('Supabase did not confirm deleting the project. Your board was left unchanged.');
 if(watched===cloudId){subscription?.();subscription=null;watched=''}
 delete links[pid];store(LINKS,links);
 delete bases[pid];store(BASE,bases);
 delete deletedIntents[pid];store(DELETED,deletedIntents);
 delete nameDirty[pid];store(NAME_DIRTY,nameDirty);
 delete knownNames[pid];store(NAME_KNOWN,knownNames);
 delete teamByProject[pid];
 store('gp-account-teams-v1:'+user.id,teamByProject);
 cloudProjectList=cloudProjectList.filter(p=>p.id!==cloudId);
 store('gp-account-cloud-projects-v1:'+user.id,cloudProjectList);
 return true;
}
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
  '<div class="controls"><button type="button" class="button main" id="gpCopyInvite">Copy invite link</button><span id="gpCopyFeedback" class="gp-inline-feedback" role="status" aria-live="polite"></span></div>'+
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
  const button=$s('#gpCopyInvite'),feedback=$s('#gpCopyFeedback');
  try{
   await navigator.clipboard.writeText(generated);
   button.textContent='✓ Copied';button.classList.add('gp-copied');
   feedback.textContent='Link copied! Send it in Discord.';
  }catch{
   input.focus();input.select();
   feedback.textContent='Select the link and press Ctrl+C to copy it.';
  }
  clearTimeout(copyMessageTimer);
  copyMessageTimer=setTimeout(()=>{
   if(button.isConnected){button.textContent='Copy invite link';button.classList.remove('gp-copied')}
   if(feedback.isConnected)feedback.textContent='';
  },2200);
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
  activeProject=existing[0];saveProject();render();await reloadTeam(existing[0]);schedule();return;
 }
 // Fresh browser: download to a new local project without touching any data
 // already saved locally. Do not sync-upload before establishing a baseline.
 const items=await api.loadProjectItems(cloudId);
 const pid='cloud-'+cloudId;
 if(data.projects.some(p=>String(p.project_id)===pid)){
  saveLink(pid,cloudId);
  activeProject=pid;saveProject();render();await reloadTeam(pid);return;
 }
 const draft=clone(data);
 draft.projects.push({project_id:pid,project_name:found.name,description:'',status:'Active',project_manager_member_id:accountMemberId(found.owner_id)});
 knownNames[pid]=found.name;store(NAME_KNOWN,knownNames);
 const imported=remoteRows(items,pid);
 for(const row of Object.values(imported)){
  // New teammates should never see intentionally deleted features or tasks.
  if(row.payload?.__gp_deleted)continue;
  draft[row.kind].push({...row.payload,project_id:pid});
 }
 for(const member of items.team||[]){
  if(!draft.members.some(m=>String(m.member_id)===String(member.member_id))){
   const m={member_id:member.member_id,display_name:member.display_name||String(member.member_id),google_email:'',active:'Yes'};
   draft.members.push(m);draft.roster.push({...m});
  }
 }
 data=draft;oldPersist();saveLink(pid,cloudId);persistBaseline(pid,imported);
 activeProject=pid;saveProject();render();await watch();await reloadTeam(pid);refreshStatus();
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
 $s('#gpSyncConnect').onclick=()=>{if(user)void window.GamePlanAccounts?.accountDialog?.();else window.GamePlanAccounts?.showLogin?.({configured:!!(config()?.url&&config()?.key)})};
 $s('#gpSyncShare').onclick=()=>void shareCurrent();
 $s('#gpSyncStatus').onclick=()=>{
  const pid=String(activeProject||''),diff=links[pid]?changesSince(bases[pid]||{},projectRows(pid)):{};
  const countsByKind={};
  for(const change of Object.values(diff)){
   const kind=change?.kind||'deleted items';
   countsByKind[kind]=(countsByKind[kind]||0)+1;
  }
  const titlePending=!!nameDirty[pid];
  const count=Object.keys(diff).length+(titlePending?1:0);
  const summary=[...Object.entries(countsByKind).map(([kind,n])=>n+' '+kind),...(titlePending?['1 project title']:[])].join(', ')||'none';
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
// Realtime is the fast path. A lightweight refresh every 12 seconds is a
// fallback when a browser silently loses its websocket connection.
let teamRefreshCounter=0;
setInterval(()=>{
 if(document.hidden||!navigator.onLine)return;
 if(ready&&api&&user&&current()){
  void reconcile(String(activeProject));
  if(++teamRefreshCounter%3===0)void reloadTeam(activeProject).catch(err=>console.warn('[GamePlan team refresh]',err));
  return;
 }
 void initialize().then(schedule);
},12000);
function isMissingAppInvitesMigration(err){
 return /gp_(?:app_access_status|accept_app_invite|create_app_invite|list_app_invites|revoke_app_invite)|PGRST202|42883|Could not find the function|schema cache/i.test(String(err?.message||''));
}
async function checkAppPermission(){
 if(!user)return false;
 // Offline returning users retain their last known approval. New accounts
 // must come online once to redeem an invitation and establish their access.
 if(!navigator.onLine){
  if(read('gp-app-approved-v1:'+user.id,false)){appAccess={access:true,admin:false,installed:true};return true}
  // Existing per-user offline work predates optional app-invite support.
  // Do not lock returning users out of local files while disconnected.
  if(read('gp-account-board-v1:'+user.id,null)){
   appAccess={access:true,admin:false,installed:false};return true;
  }
  ready=false;activatedUserId='';$s('#mainApp').hidden=true;
  window.GamePlanAccounts?.showAccessRequired?.('Connect to the internet to verify your GamePlan invitation.');
  return false;
 }
 const appToken=sessionStorage.getItem(PENDING_APP);
 try{
  // Claim older email-based project invites first, then check access.
  // Existing accounts should never consume a use of an app-wide invite.
  await api.listProjects();
  let result=await api.appAccessStatus();
  if(!result?.access){
   const projectToken=sessionStorage.getItem(PENDING_INVITE);
   if(projectToken&&!(preAcceptedProjectId&&preAcceptedProjectToken===projectToken)){
    preAcceptedProjectId=await api.acceptLinkInvite(projectToken);
    preAcceptedProjectToken=projectToken;
   }
   if(appToken)await api.acceptAppInvite(appToken);
   if(projectToken||appToken)result=await api.appAccessStatus();
  }
  if(appToken&&result?.access)sessionStorage.removeItem(PENDING_APP);
  appAccess={access:!!result?.access,admin:!!result?.admin,installed:true};
  if(!appAccess.access){
   ready=false;activatedUserId='';
   $s('#mainApp').hidden=true;
   window.GamePlanAccounts?.showAccessRequired?.('This account has not been invited to GamePlan yet. Ask for a GamePlan access link, then open it while signed into this account.');
   return false;
  }
  store('gp-app-approved-v1:'+user.id,true);
  return true;
 }catch(err){
  if(isMissingAppInvitesMigration(err)){
   if(appToken){
    ready=false;activatedUserId='';$s('#mainApp').hidden=true;
    window.GamePlanAccounts?.showAccessRequired?.('GamePlan access invitations need the one-time Supabase app-invites.sql setup. Ask the owner to install it.');
   }else appAccess={access:true,admin:false,installed:false};
   return !appToken;
  }
  ready=false;activatedUserId='';$s('#mainApp').hidden=true;
  window.GamePlanAccounts?.showAccessRequired?.('Could not verify GamePlan access: '+String(err?.message||err));
  return false;
 }
}
async function initialize(){
 try{
  const online=await checkAccount();
  if(!online){
   ready=false;activatedUserId='';
   const panel=$s('#gpLogin');
   if(!panel||panel.hidden)window.GamePlanAccounts?.showLogin?.({configured:!!(config()?.url&&config()?.key)});
   refreshStatus();return;
  }
  if(!await checkAppPermission()){refreshStatus();return}
  await activateAccount();
  if(!navigator.onLine){
   window.GamePlanAccounts?.onAuthenticated?.(user);
   refreshStatus();return;
  }
  await refreshProjectList();
  if(activeProject)await reloadTeam(activeProject);
  await watch();
  // Redeem secret links server-side before reading any project data.
  const token=sessionStorage.getItem(PENDING_INVITE);
  if(token&&!inviteAttempted){
   inviteAttempted=true;
   try{
    // The app-level access check may have redeemed this project invite once
    // already. Never consume it a second time: the link could now be full.
    const inviteCloudId=preAcceptedProjectToken===token&&preAcceptedProjectId
     ?preAcceptedProjectId
     :await api.acceptLinkInvite(token);
    await joinShared(inviteCloudId);
    sessionStorage.removeItem(PENDING_INVITE);
    preAcceptedProjectId='';preAcceptedProjectToken='';
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
window.GamePlanSync={
 connect,shareCurrent,shareInvite,schedule,backup:downloadBackup,deleteSharedProject,
 isLinked:pid=>!!links[String(pid)],status:refreshStatus,
 currentUser:()=>user,api:()=>api,roleFor,
 ownAssigneeIds(pid=activeProject){
  if(!user||activatedUserId!==user.id)return [];
  const ids=new Set([accountMemberId(user.id),user.id]);
  const profile=teamByProject[String(pid)]?.find(m=>m.member_user_id===user.id);
  if(profile?.legacy_member_id)ids.add(String(profile.legacy_member_id));
  if(roleFor(pid)==='owner'&&data.me?.member_id)ids.add(String(data.me.member_id));
  return [...ids];
 },
 isMine(task){return !!task&&this.ownAssigneeIds(task.project_id).includes(String(task.assignee_member_id))},
 async signInProvider(provider){
  if(!config()?.url||!config()?.key)throw Error('Connect a GamePlan workspace first.');
  api=null;await checkAccount();
  return api.signInWithProvider(provider);
 },
 async signInEmail(email){
  if(!config()?.url||!config()?.key)throw Error('Connect a GamePlan workspace first.');
  api=null;await checkAccount();return api.signInWithEmail(email);
 },
 async setPublicConfig(url,key){
  const clean=String(url||'').trim().replace(/\/$/,'');
  const publicKey=String(key||'').trim();
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(clean))throw Error('Invalid Supabase workspace URL.');
  if(!publicKey||/sb_secret_|service_role/i.test(publicKey))throw Error('Use only the public publishable key.');
  store(CFG,{url:clean,key:publicKey});api=null;
 },
 resetClient(){if(!user)api=null},
 async signOut(){
  if(api)await api.signOut();
  window.GamePlanAvatars?.clear?.();
  user=null;ready=false;activatedUserId='';teamByProject={};cloudProjectList=[];appAccess={access:true,admin:false,installed:false};preAcceptedProjectId='';preAcceptedProjectToken='';
  subscription?.();subscription=null;watched='';
  $s('#mainApp').hidden=true;
  window.GamePlanAccounts?.showLogin?.({configured:!!(config()?.url&&config()?.key)});
  refreshStatus();
 },
 appAccess:()=>({...appAccess}),
 publicConfig:()=>config(),
 async createAppInvite(days,uses){
  if(!api||!user||!appAccess.admin)throw Error('Only a GamePlan access administrator can invite people.');
  return api.createAppInvite(days,uses);
 },
 async listAppInvites(){if(!api||!appAccess.admin)throw Error('Admin permission required');return api.listAppInvites()},
 async revokeAppInvite(id){if(!api||!appAccess.admin)throw Error('Admin permission required');return api.revokeAppInvite(id)},
 async identities(){if(!api)throw Error('Not connected');return api.linkedIdentities()},
 async linkIdentity(provider){if(!api)throw Error('Not connected');return api.linkIdentity(provider)},
 async addEmail(email){if(!api)throw Error('Not connected');return api.addEmailIdentity(email)},
 async createProject(name){return createAuthenticatedProject(name)},
 async reloadTeam(){return reloadTeam(activeProject)},
 async setMemberDetails(id,name,legacyId){
  if(roleFor()!=='owner')throw Error('Only project owners can rename teammates.');
  return api.setTeamMember(current(),id,name,legacyId);
 },
 async setMemberRole(id,role){
  if(roleFor()!=='owner')throw Error('Only project owners can change permissions.');
  return api.setTeamRole(current(),id,role);
 },
 async removeMemberAccess(id){
  if(roleFor()!=='owner')throw Error('Only project owners can remove access.');
  return api.removeTeamMember(current(),id);
 }
};
})();
