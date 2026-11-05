/* GamePlan Cloud mode — the SAME index.html and gameplan.js as the local board.
   Activated only by ?cloud=1. Local project storage is a separate cache.
   Supabase is authoritative; edits sync per row, not via whole-board uploads. */
(function(){
'use strict';
if(!new URLSearchParams(location.search).has('cloud'))return;
const CONFIG_KEY='gameplan-cloud-config-v1';
const KINDS=['milestones','features','tasks','logs','tags','templates','team','custom_tag_colors'];
const IDENT={milestones:'milestone_id',features:'feature_id',tasks:'task_id',logs:'log_id',tags:'tag_id',templates:'template_id',team:'member_id'};
const $cloud=selector=>document.querySelector(selector);
let api=null,me=null,cloudProjects=[],knownMembers=[],role='viewer',baseline=new Map(),queue=Promise.resolve(),syncError=null,unsubscribe=null,loading=false,remoteTimer=null,localVersion=0;
let currentProjectId='';
const note=(msg,err=false)=>{let el=$cloud('#gpCloudState');if(el){el.textContent=msg;el.classList.toggle('gp-cloud-error',err)}};
function config(){try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||'null')}catch{return null}}
function itemKey(kind,id){return kind+'\u0000'+id}
function idOf(kind,item){
 if(kind==='custom_tag_colors')return 'color:'+item.color;
 if(kind==='team')return 'member:'+item.member_id;
 return String(item[IDENT[kind]]||'');
}
function flatSnapshot(items,projectId){
 const out=new Map();
 const taskIds=new Set((items.tasks||[])
  .filter(t=>String(t.project_id)===String(projectId))
  .map(t=>String(t.task_id)));
 for(const kind of KINDS){
  const arr=(items[kind]||[]).filter(it=>kind==='logs'
   ?taskIds.has(String(it.task_id))
   :String(it.project_id)===String(projectId));
  for(const [index,item] of arr.entries()){
   const id=idOf(kind,item);if(!id)continue;
   const value={kind,item_id:id,payload:{...item,project_id:projectId},sort_order:index};
   out.set(itemKey(kind,id),value);
  }
 }
 return out;
}
function existingSnapshot(projectId){return flatSnapshot(data,projectId)}
function same(a,b){return a?.sort_order===b?.sort_order&&JSON.stringify(a?.payload)===JSON.stringify(b?.payload)}
async function syncCaptured(projectId,captured,projectName){
 if(!api||!me)throw Error('Cloud connection is not ready');
 const before=baseline;
 const update=[...captured].filter(([key,value])=>!same(before.get(key),value)).map(([,value])=>value);
 const removed=[...before].filter(([key])=>!captured.has(key)).map(([,value])=>value);
 const project=cloudProjects.find(p=>p.id===projectId);
 if(project&&project.name!==projectName){
  await api.renameProject(projectId,projectName);
  project.name=projectName;
 }
 const token=await api.client.auth.getUser();
 if(token.error||!token.data.user)throw Error('Session expired. Please sign in again.');
 const updated_by=token.data.user.id;
 for(let i=0;i<update.length;i+=60){
  const rows=update.slice(i,i+60).map(row=>({...row,project_id:projectId,updated_by,updated_at:new Date().toISOString()}));
  const {error}=await api.client.from('gp_items').upsert(rows,{onConflict:'project_id,kind,item_id'});
  if(error)throw error;
 }
 for(const row of removed){
  const {error}=await api.client.from('gp_items').delete().eq('project_id',projectId).eq('kind',row.kind).eq('item_id',row.item_id);
  if(error)throw error;
 }
 baseline=captured;
 return {updated:update.length,removed:removed.length};
}
function saveLater(){
 // Preserve local undo/redo and a separate offline mirror; NEVER touch local mode data.
 oldPersist();
 if(loading||!api||!currentProjectId)return;
 if(role==='viewer'){gpAlert('This project is read-only for your account.');void loadProject(currentProjectId);return}
 const projectId=currentProjectId;
 // Persist display names inside project team rows; the base app keeps its
 // roster separately, while the cloud schema stores project-scoped items.
 for(const member of data.team||[]){
  const profile=data.members.find(x=>String(x.member_id)===String(member.member_id));
  if(profile)member.display_name=profile.display_name;
 }
 const snapshot=existingSnapshot(projectId);
 const currentName=data.projects.find(p=>p.project_id===projectId)?.project_name||'Untitled';
 localVersion++;
 note('Saving to cloud…');
 queue=queue.catch(()=>{}).then(async()=>{
  try{
   const result=await syncCaptured(projectId,snapshot,currentName);
   syncError=null;note('Cloud synced');
   return result;
  }catch(err){
   syncError=err;note('Could not save to cloud: '+err.message,true);
   throw err;
  }
 });
}
const oldPersist=persist;
persist=saveLater;
function memberLabel(id){
 const value=String(id||'');
 const known={penni:'Penni',ethan:'Ethan',jerry:'Jerry',jenny:'Jenny'};
 return known[value.toLowerCase()]||value.replace(/[-_]/g,' ').replace(/\b\w/g,s=>s.toUpperCase()).slice(0,36)||'Teammate';
}
function constructMembers(items,memberships){
 const ids=new Set();
 for(const x of items.team||[])ids.add(String(x.member_id));
 for(const x of items.tasks||[])if(x.assignee_member_id)ids.add(String(x.assignee_member_id));
 for(const x of items.logs||[])if(x.member_id)ids.add(String(x.member_id));
 if(me)ids.add(me.id);
 for(const m of memberships)ids.add(String(m.user_id));
 return [...ids].map(id=>({
  member_id:id,
  display_name:id===me.id?(me.user_metadata?.full_name||me.user_metadata?.name||me.user_metadata?.preferred_username||me.email||'You'):(items.team||[]).find(t=>String(t.member_id)===id)?.display_name||memberLabel(id),
  google_email:id===me.id?me.email||'':'',
  active:'Yes'
 }));
}
async function loadProject(preferredId){
 if(!api||loading)return;
 loading=true;note('Loading shared project…');
 try{
  await queue;
  cloudProjects=await api.listProjects();
  if(!cloudProjects.length){
   currentProjectId='';baseline=new Map();
   data={me:{member_id:me.id,display_name:me.user_metadata?.name||'You'},email:me.email,
    projects:[],members:[],roster:[],memberships:[],team:[],milestones:[],features:[],tasks:[],logs:[],tags:[],templates:[],custom_tag_colors:[]};
   showWelcome();
   return;
  }
  const found=cloudProjects.find(p=>p.id===preferredId)||cloudProjects[0];
  currentProjectId=found.id;
  activeProject=found.id;saveProject();
  const [items,memberships]=await Promise.all([api.loadProjectItems(found.id),api.listMembers(found.id)]);
  knownMembers=memberships;
  role=memberships.find(m=>m.user_id===me.id)?.role||'viewer';
  const members=constructMembers(items,memberships);
  const team=[...(items.team||[])];
  // Link authenticated collaborators to team entries without modifying imported
  // names or legacy task assignees.
  for(const m of memberships){
   if(!team.some(t=>String(t.member_id)===String(m.user_id)))
    team.push({project_id:found.id,member_id:m.user_id,project_role:m.role==='owner'?'PM':'Member',discipline:'',membership_status:'Active'});
  }
  data={
   me:{member_id:me.id,display_name:members.find(m=>m.member_id===me.id)?.display_name||'You'},
   email:me.email||'',
   projects:cloudProjects.map(p=>({project_id:p.id,project_name:p.name,description:'',status:'Active',project_manager_member_id:p.owner_id})),
   members,roster:members.map(m=>({...m})),
   memberships:memberships.map(m=>({project_id:m.project_id,member_id:m.user_id,project_role:m.role==='owner'?'PM':'Member',membership_status:'Active',discipline:''})),
   team,...items
  };
  data.team=team;
  baseline=flatSnapshot(items,found.id);
  syncError=null;
  oldPersist();  // Cache only, don't push synthetic team entries to the server.
  hideWelcome();
  $cloud('#mainApp').hidden=false;
  render();
  $cloud('#gpCloudAccount').textContent=me.user_metadata?.name||me.email||'Discord';
  $cloud('#gpCloudShare').hidden=role!=='owner';
  $cloud('#gpCloudRole').textContent=role;
  note('Cloud synced');
  unsubscribe?.();
  unsubscribe=api.subscribeProject(found.id,()=>{
   if(loading||syncError)return;
   clearTimeout(remoteTimer);
   remoteTimer=setTimeout(async()=>{
    // Do not interrupt edits or overwrite queued local operations.
    if($cloud('#back.show')||document.activeElement?.matches('input,textarea,[contenteditable="true"]')){note('Team updates available · Reload to see changes');return}
    try{await queue;await loadProject(currentProjectId)}
    catch(err){note('Cloud refresh failed: '+err.message,true)}
   },650);
  });
 }catch(err){note('Cloud load failed: '+err.message,true);if(!$cloud('#mainApp')||!$cloud('#mainApp').offsetParent)showWelcome('Could not load projects: '+err.message)}
 finally{loading=false;document.documentElement.classList.remove('gp-cloud-loading')}
}
const previousRefresh=refresh;
refresh=function(){if(!api)return previousRefresh();return queue.then(()=>loadProject(currentProjectId))};
const previousRpc=rpc;
rpc=async function(op,p={}){
 if(!api)return Promise.reject(Error('Cloud connection is unavailable'));
 if(op!=='createProject'&&role==='viewer')throw Error('You have view-only access to this project.');
 if(op==='removeMember'&&knownMembers.some(m=>String(m.user_id)===String(p.member_id))){
  if(role!=='owner')throw Error('Only project owners can remove a teammate’s cloud access.');
  if(data.tasks.some(t=>t.project_id===currentProjectId&&String(t.assignee_member_id)===String(p.member_id)))throw Error('Reassign the member’s tasks before removing access.');
  const {error}=await api.client.from('gp_members').delete().eq('project_id',currentProjectId).eq('user_id',p.member_id);
  if(error)throw error;
  knownMembers=knownMembers.filter(m=>String(m.user_id)!==String(p.member_id));
 }
 if(op==='createProject'){
  await queue;
  const created=await api.createProject(p.name);
  activeProject=created.id;await loadProject(created.id);return {ok:true};
 }
 return previousRpc(op,p);
};
const originalSwitch=gpSwitchProject;
const originalRename=gpRenameProjectInline;
gpRenameProjectInline=function(){if(role!=='owner'){gpAlert('Only the project owner can rename a shared project.');$cloud('#gpProjectTitle').value=data.projects.find(p=>p.project_id===activeProject)?.project_name||'';return}return originalRename()};
gpSwitchProject=function(id){
 if(!api)return originalSwitch(id);
 if(id===currentProjectId)return;
 void loadProject(id);
};
// New team invitations are cloud permissions, not merely local roster entries.
async function inviteTeammate(){
 if(!api||!activeProject)return;
 const address=await gpPrompt('Invite teammate by Discord account email','');
 if(!address?.trim())return;
 try{await api.inviteByEmail(activeProject,address.trim(),'editor');gpAlert('Invitation saved. Ask your teammate to sign into GamePlan Cloud with Discord using that email.')}
 catch(err){gpAlert('Could not invite teammate: '+err.message)}
}
gpDeleteProject=async function(){
 if(role!=='owner'){gpAlert('Only the project owner can delete this project.');return}
 const project=data.projects.find(p=>p.project_id===activeProject);if(!project)return;
 if(!await gpConfirm('Permanently delete “'+project.project_name+'” and all of its cloud data for every teammate?',{danger:true,confirmLabel:'Delete project'}))return;
 const typed=await gpPrompt('Type the project name to confirm deletion','');
 if(typed!==project.project_name)return;
 try{
  await queue;
  const {error}=await api.client.from('gp_projects').delete().eq('id',activeProject);
  if(error)throw error;
  unsubscribe?.();unsubscribe=null;
  currentProjectId='';
  await loadProject('');
 }catch(err){gpAlert('Could not delete project: '+err.message)}
};
function ensureCloudUI(){
 const header=$cloud('.workspace .top');
 if(!header)return;
 const status=document.createElement('div');
 status.className='gp-cloud-toolbar';
 status.innerHTML='<div class="gp-cloud-status"><span class="gp-cloud-status-dot" aria-hidden="true"></span><strong>Cloud</strong><span id="gpCloudState">Connecting…</span><span class="gp-cloud-role" id="gpCloudRole"></span><span class="gp-cloud-account" id="gpCloudAccount"></span></div><div class="gp-cloud-controls"><button type="button" class="button gp-cloud-primary" id="gpCloudShare" hidden>Share project</button><button type="button" class="button" id="gpCloudReload">↻ Sync</button><a class="button" href="index.html">Local board</a><button type="button" class="button" id="gpCloudSignOut">Sign out</button></div>';
 const actions=header.querySelector('.gp-header-actions');
 const rail=document.createElement('div');
 rail.className='gp-cloud-header-rail';
 if(actions){actions.before(rail);rail.append(actions)}else header.append(rail);
 rail.append(status);
 $cloud('#gpCloudShare').onclick=inviteTeammate;
 $cloud('#gpCloudReload').onclick=()=>void loadProject(currentProjectId);
 $cloud('#gpCloudSignOut').onclick=async()=>{try{await api?.signOut();location.href='supabase/discord.html'}catch(err){gpAlert('Could not sign out: '+err.message)}};
 const version=$cloud('#appVersion');if(version)version.textContent='Cloud beta · v2026.11.05.53';
 const oldLink=$cloud('.top-actions a[href*="cloud=1"]');if(oldLink)oldLink.remove();
 // Full-board file replacement could overwrite teammates' changes; keep export,
 // but disable the destructive whole-board import in cloud mode.
 $cloud('#import')?.setAttribute('hidden','');
 $cloud('#importMilestone')?.setAttribute('title','Add a milestone from a file to this shared project');
}
function showWelcome(error=''){
 const overlay=document.getElementById('gpCloudWelcome')||document.createElement('div');
 overlay.id='gpCloudWelcome';overlay.className='gp-cloud-setup';
 overlay.innerHTML='<h1>GamePlan Cloud</h1><p>'+e(error||'You are connected! Create your first shared project or import one from the Cloud Preview.')+'</p><p><button class="button main" id="gpCloudCreateFirst" type="button">+ Create shared project</button> <a class="button" href="supabase/discord.html">Cloud Preview / import projects</a> <a class="button" href="index.html">Local board</a></p>';
 const create=overlay.querySelector('#gpCloudCreateFirst');
 create.disabled=!api||!me;
 create.onclick=async()=>{
  const name=await gpPrompt('New shared project name','');
  if(!name?.trim())return;
  try{const project=await api.createProject(name.trim());await loadProject(project.id)}
  catch(err){gpAlert('Could not create project: '+err.message)}
 };
 $cloud('.workspace').prepend(overlay);
 $cloud('#mainApp').hidden=true;
}
function hideWelcome(){document.getElementById('gpCloudWelcome')?.remove()}
ensureCloudUI();
(async function boot(){
 try{
  const cfg=config();
  if(!cfg?.url||!cfg?.key){
   showWelcome('First connect your Supabase project in the Cloud Preview. Then return to this page.');
   return;
  }
  const module=await import('./supabase/gameplan-cloud.js?v=2026.11.05.51');
  api=module.createGamePlanCloud({url:cfg.url,publishableKey:cfg.key});
  const session=await api.getSession();
  if(!session){
   showWelcome('Sign into Discord using the Cloud Preview. Then return here to use the complete GamePlan interface.');
   return;
  }
  const {data:result,error}=await api.client.auth.getUser();
  if(error||!result.user)throw error||Error('Not signed in');
  me=result.user;
  await loadProject(readProject());
 }catch(err){note('Connection error: '+err.message,true);showWelcome(err.message)}
 finally{document.documentElement.classList.remove('gp-cloud-loading')}
})();
})();
