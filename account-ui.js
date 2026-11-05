/* GamePlan account, login and authentic team UI.
   No private data is shown until Supabase confirms the signed-in account.
   Existing browser boards are offered for non-destructive migration. */
(function(){
'use strict';
const $a=s=>document.querySelector(s);
const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials=s=>String(s||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('')||'?';
let currentUser=null,loginBusy=false,teamRows=[],accountRole='viewer',teamUpgradeNeeded=false,lastTeamProject='',copyMessageTimer=null;
const brand='<img src="gameplan-mark.svg" alt="" class="gp-auth-mark"><span class="gp-auth-word">Game<span>Plan</span></span>';
const discordIcon='<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M19.7 5.2a18 18 0 0 0-4.5-1.4l-.5 1a16 16 0 0 0-5.4 0l-.5-1a18 18 0 0 0-4.5 1.4C1.4 9.2.6 13.2 1 17.2c1.8 1.4 3.6 2.2 5.3 2.8l1.1-1.8c-.6-.2-1.1-.5-1.6-.9l.4-.3a12 12 0 0 0 11.6 0l.4.3c-.5.4-1 .7-1.6.9l1.1 1.8c1.7-.6 3.5-1.4 5.3-2.8.6-4.7-.9-8.7-3.3-12ZM8.6 15.2c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2c1.2 0 2.1 1 2 2.2.1 1.2-.8 2.2-2 2.2Zm6.8 0c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2.1 1 2 2.2c0 1.2-.9 2.2-2 2.2Z"/></svg>';
const googleIcon='<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.3Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.5l-3.2-2.5c-.9.6-2 .9-3.4.9a6 6 0 0 1-5.7-4.2H3v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.3 13.7a6 6 0 0 1 0-3.4V7.7H3a10 10 0 0 0 0 8.6l3.3-2.6Z"/><path fill="#EA4335" d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.7l3.3 2.6A6 6 0 0 1 12 6.1Z"/></svg>';
function loginRoot(){
 let root=$a('#gpLogin');
 if(root)return root;
 root=document.createElement('main');root.id='gpLogin';root.setAttribute('aria-label','Sign in to GamePlan');
 document.body.append(root);return root;
}
function loginMessage(message,bad=false){
 const label=$a('#gpAuthFeedback');if(!label)return;
 label.textContent=message||'';label.classList.toggle('bad',bad);
}
function rememberSetting(){
 const box=$a('#gpRemember');
 if(box)localStorage.setItem('gp-remember-login-v1',box.checked?'true':'false');
 window.GamePlanSync?.resetClient?.();
}
function showLogin({configured=false,message=''}={}){
 currentUser=null;
 document.documentElement.classList.add('gp-auth-locked');
 const root=loginRoot();
 const previous=localStorage.getItem('gp-known-account-v1');
 const remember=localStorage.getItem('gp-remember-login-v1')!=='false';
 root.hidden=false;
 root.innerHTML='<div class="gp-auth-orb gp-auth-orb-a"></div><div class="gp-auth-orb gp-auth-orb-b"></div>'+
 '<div class="gp-auth-panel"><div class="gp-auth-brand">'+brand+'</div>'+
 '<h1>Make space for your next big idea.</h1><p class="gp-auth-intro">Your projects, your people, one place to plan together.</p>'+
 (previous?'<div class="gp-auth-return">Welcome back! Use your usual sign-in method. You can link another method after signing in.</div>':'')+
 '<div class="gp-auth-methods">'+
 '<button type="button" class="gp-auth-method gp-auth-discord" id="gpSignDiscord">'+discordIcon+'<span>Continue with Discord</span></button>'+
 '<button type="button" class="gp-auth-method" id="gpSignGoogle">'+googleIcon+'<span>Continue with Google</span></button>'+
 '<div class="gp-auth-divider"><span>or use your email</span></div>'+
 '<form id="gpEmailSignIn"><label for="gpLoginEmail">Email address</label><div class="gp-auth-email-row"><input id="gpLoginEmail" type="email" name="email" placeholder="you@example.com" autocomplete="email" required><button type="submit" class="gp-auth-email-button">Email me a sign-in link</button></div></form>'+
 '</div><label class="gp-auth-remember"><input id="gpRemember" type="checkbox" '+(remember?'checked':'')+'>Keep me signed in on this device</label>'+
 (!configured?'<div class="gp-auth-configuration"><details id="gpWorkspaceSetup" open><summary>Connect your GamePlan workspace</summary><p>This browser needs your workspace’s public Supabase URL and publishable key. Teammate invite links set these automatically.</p><form id="gpAuthConfig"><input type="url" name="url" placeholder="https://your-project.supabase.co" required><input type="text" name="key" placeholder="sb_publishable_…" required><button type="submit">Save workspace connection</button></form></details></div>':'')+
 '<p id="gpAuthFeedback" class="gp-auth-feedback" role="status"></p>'+
 '<p class="gp-auth-foot">GamePlan saves a private working copy in your browser, then syncs to your team when you’re online.</p></div>';
 loginMessage(message);
 $a('#gpRemember').onchange=rememberSetting;
 $a('#gpSignDiscord').onclick=()=>void signIn('discord');
 $a('#gpSignGoogle').onclick=()=>void signIn('google');
 $a('#gpEmailSignIn').onsubmit=async ev=>{
  ev.preventDefault();if(loginBusy)return;
  const address=new FormData(ev.currentTarget).get('email');
  rememberSetting();loginBusy=true;loginMessage('Sending your sign-in email…');
  try{
   await window.GamePlanSync.signInEmail(String(address));
   loginMessage('Check your inbox for a GamePlan sign-in link.');
  }catch(err){loginMessage('Could not send the email: '+err.message,true)}
  finally{loginBusy=false}
 };
 $a('#gpAuthConfig')?.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const fields=Object.fromEntries(new FormData(ev.currentTarget).entries());
  try{
   await window.GamePlanSync.setPublicConfig(fields.url,fields.key);
   showLogin({configured:true,message:'Workspace connected! Choose a sign-in method.'});
  }catch(err){loginMessage(err.message,true)}
 });
}
async function signIn(provider){
 if(loginBusy)return;
 rememberSetting();loginBusy=true;loginMessage('Opening '+(provider==='google'?'Google':'Discord')+'…');
 try{await window.GamePlanSync.signInProvider(provider)}
 catch(err){loginMessage('Unable to sign in: '+err.message,true);loginBusy=false}
}
function showWorkspace(){
 $a('#gpLogin')?.setAttribute('hidden','');
 document.documentElement.classList.remove('gp-auth-locked');
 document.documentElement.classList.add('gp-auth-ready');
}
async function requestMigration({projectCount=0,taskCount=0,logCount=0}={}){
 return new Promise(resolve=>{
  const root=loginRoot();root.hidden=false;
  document.documentElement.classList.add('gp-auth-locked');
  root.innerHTML='<div class="gp-auth-panel gp-auth-migration"><div class="gp-auth-brand">'+brand+'</div>'+
   '<h1>We found your old GamePlan board.</h1><p class="gp-auth-intro">Would you like to keep its projects and progress in this signed-in account?</p>'+
   '<div class="gp-auth-recovery"><strong>'+projectCount+' project(s) · '+taskCount+' tasks · '+logCount+' time entries</strong>'+
   '<span>The original browser copy stays untouched either way. Nothing is deleted from the cloud.</span></div>'+
   '<div class="gp-auth-choice"><button type="button" class="gp-auth-method gp-auth-discord" id="gpKeepOld">Keep my existing board</button>'+
   '<button type="button" class="gp-auth-method" id="gpStartBlank">Start with an empty workspace</button></div>'+
   '<p class="gp-auth-foot">You can still recover your original JSON backup later.</p></div>';
  $a('#gpKeepOld').onclick=()=>resolve('copy');
  $a('#gpStartBlank').onclick=()=>resolve('empty');
 });
}
function emptyWorkspace(){
 const work=$a('.workspace'),main=$a('#mainApp');if(!work||!main)return;
 let root=$a('#gpEmptyWorkspace');
 if(!root){root=document.createElement('section');root.id='gpEmptyWorkspace';root.className='gp-empty-workspace';work.append(root)}
 root.hidden=false;main.hidden=true;
 root.innerHTML='<div class="gp-empty-symbol"><img src="gameplan-mark.svg" alt=""></div>'+
  '<h1>Your workspace is ready.</h1><p>Start with a new project, then invite your teammates.</p>'+
  '<button type="button" class="button main gp-empty-create" id="gpFirstProject">+ Create your first project</button>';
 $a('#gpFirstProject').onclick=()=>void createProjectDialog();
}
function hideEmpty(){
 $a('#gpEmptyWorkspace')?.setAttribute('hidden','');
 const main=$a('#mainApp');if(main)main.hidden=false;
}
async function createProjectDialog(){
 const name=await gpPrompt('Name your project','');
 if(!name?.trim())return;
 try{await window.GamePlanSync.createProject(name.trim());hideEmpty()}
 catch(err){gpAlert('Could not create project: '+err.message)}
}
function authName(u){
 return u?.user_metadata?.preferred_username||u?.user_metadata?.global_name||u?.user_metadata?.name||
 u?.user_metadata?.full_name||u?.user_metadata?.user_name||u?.email?.split('@')[0]||'Your account';
}
function onAuthenticated(user){
 currentUser=user;localStorage.setItem('gp-known-account-v1','1');
 showWorkspace();
 const trigger=$a('#gpSyncConnect');
 if(trigger){trigger.textContent=authName(user);trigger.title='Account and connected sign-in methods'}
}
async function accountDialog(){
 if(!currentUser)return;
 let ids=[];
 try{ids=await window.GamePlanSync.identities()}catch(err){gpAlert('Could not read identities: '+err.message)}
 const providers=new Set(ids.map(x=>x.provider));
 const connected=ids.length?ids.map(x=>'<span class="gp-provider-chip">'+html(x.provider)+'</span>').join(' '):'<span class="sub">Current sign-in provider</span>';
 modal('Your GamePlan account',
  '<div class="gp-account-head"><div class="gp-account-avatar">'+html(initials(authName(currentUser)))+'</div>'+
  '<div><strong>'+html(authName(currentUser))+'</strong><p class="sub">'+html(currentUser.email||'')+'</p></div></div>'+
  '<h3>Sign-in methods</h3><p class="sub">Link another login to this same account. Your existing projects stay on this account.</p>'+
  '<div class="gp-provider-chips">'+connected+'</div>'+
  '<div class="gp-account-link-actions">'+
  '<button type="button" class="button" data-link-provider="discord" '+(providers.has('discord')?'disabled':'')+'>'+discordIcon+' Link Discord</button>'+
  '<button type="button" class="button" data-link-provider="google" '+(providers.has('google')?'disabled':'')+'>'+googleIcon+' Link Google</button></div>'+
  '<div class="gp-link-email"><label>Email address for sign-in<input type="email" id="gpAccountEmail" value="'+html(currentUser.email||'')+'" autocomplete="email"></label>'+
  '<button type="button" class="button" id="gpLinkEmail">Add / update email</button></div>'+
  '<p class="sub">OAuth linking requires manual identity linking to be enabled in Supabase. You must verify ownership of the second login; GamePlan never merges accounts automatically.</p>'+
  '<div class="controls"><button type="button" class="button" id="gpAccountSignOut">Sign out</button>'+
  '<button type="button" class="button main" id="gpAccountClose">Done</button></div>');
 $a('#gpAccountClose').onclick=closeModal;
 $a('#gpAccountSignOut').onclick=async()=>{
  if(!await gpConfirm('Sign out of GamePlan? Your saved browser data will be kept.',{confirmLabel:'Sign out'}))return;
  closeModal();await window.GamePlanSync.signOut();
 };
 $a('#modalBody').querySelectorAll('[data-link-provider]').forEach(button=>button.onclick=async()=>{
  try{
   button.disabled=true;
   await window.GamePlanSync.linkIdentity(button.dataset.linkProvider);
   // OAuth redirects, so no success claim until returning with an identity.
  }catch(err){button.disabled=false;gpAlert('Could not link account: '+err.message)}
 });
 $a('#gpLinkEmail').onclick=async()=>{
  const mail=$a('#gpAccountEmail').value.trim();
  if(!mail)return gpAlert('Enter an email address.');
  try{
   await window.GamePlanSync.addEmail(mail);
   gpAlert('Check your email for a confirmation message. Once verified, the email belongs to this account.');
  }catch(err){gpAlert('Email update failed: '+err.message)}
 };
}
function teamEmpty(message){
 const area=$a('#gpExtra');if(!area)return;
 area.innerHTML='<div class="gp-team-real-head"><p class="sub">'+html(message)+'</p></div>';
}
function currentTeamRole(){
 return accountRole;
}
function setTeam(team,role,upgradeNeeded=false){
 teamRows=team||[];accountRole=role||'viewer';teamUpgradeNeeded=upgradeNeeded;
 if(gpPage==='team')renderTeamPage();
}
function memberName(m){return m.display_name||m.account_name||'Teammate'}
function renderTeamPage(){
 const area=$a('#gpExtra');if(!area)return;
 const owner=accountRole==='owner',linked=window.GamePlanSync?.isLinked?.(activeProject);
 if(!linked){
  teamEmpty('Share this project to see signed-in members and manage their access.');
  area.innerHTML+='<button type="button" class="button main" id="gpTeamShare">Share project</button>';
  $a('#gpTeamShare').onclick=()=>void window.GamePlanSync.shareCurrent();
  return;
 }
 const reserved=new Set(teamRows.map(x=>x.legacy_member_id).filter(Boolean));
 const unlinked=(data.team||[]).filter(x=>x.project_id===activeProject&&!reserved.has(x.member_id)&&
  !teamRows.some(m=>x.member_id==='account:'+m.member_user_id)&&
  !teamRows.some(m=>m.member_role==='owner'&&x.member_id===data.projects.find(p=>p.project_id===activeProject)?.project_manager_member_id));
 const rowMarkup=teamRows.map(m=>{
  const name=memberName(m),isOwner=m.member_role==='owner';
  return '<article class="gp-person-row"><div class="gp-person-avatar">'+html(initials(name))+'</div>'+
   '<div class="gp-person-copy"><strong>'+html(name)+'</strong><span class="sub">'+html(m.account_name&&m.account_name!==name?'Discord / account name: '+m.account_name:'Linked account')+'</span></div>'+
   '<span class="gp-role-pill">'+html(isOwner?'Owner':m.member_role==='editor'?'Editor':'Viewer')+'</span>'+
   (owner?'<button type="button" class="button" data-gp-authmember="'+html(m.member_user_id)+'">'+(isOwner?'Rename':'Manage')+'</button>':'')+'</article>';
 }).join('');
 area.innerHTML='<div class="gp-team-real-head"><p class="sub">Team members are real signed-in accounts. Permissions are enforced in Supabase, not just by the interface.</p>'+
 (owner?'<button type="button" class="button main" id="gpInviteTeam">+ Invite people</button>':'')+'</div>'+
 (teamUpgradeNeeded?'<p class="gp-team-upgrade">To enable account names, renaming, and permissions, run <code>supabase/team-accounts.sql</code> once in Supabase SQL Editor. Existing members are still protected by the database.</p>':'')+
 '<div class="gp-team-people">'+(rowMarkup||'<p class="sub">No accounts loaded yet. Try Sync.</p>')+'</div>'+
 (owner&&unlinked.length?'<details class="gp-legacy-members"><summary>'+unlinked.length+' older assignee(s) not linked to an account</summary>'+
 '<p class="sub">These historical records are preserved to keep their tasks and hours. Match them to a signed-in teammate using Manage.</p>'+
 '<div>'+unlinked.map(x=>'<span class="gp-legacy-chip">'+html(data.members.find(m=>m.member_id===x.member_id)?.display_name||x.member_id)+'</span>').join('')+'</div></details>':'');
 $a('#gpInviteTeam')?.addEventListener('click',()=>void window.GamePlanSync.shareCurrent());
 area.querySelectorAll('[data-gp-authmember]').forEach(b=>b.onclick=()=>void editTeamMember(b.dataset.gpAuthmember));
}
async function editTeamMember(id){
 const member=teamRows.find(m=>m.member_user_id===id);if(!member||accountRole!=='owner')return;
 const owner=member.member_role==='owner',assigned=new Set(teamRows.map(m=>m.legacy_member_id).filter(Boolean));
 const options=(data.team||[]).filter(x=>x.project_id===activeProject&&(x.member_id===member.legacy_member_id||!assigned.has(x.member_id)))
  .map(x=>({id:x.member_id,name:data.members.find(m=>m.member_id===x.member_id)?.display_name||x.member_id}));
 modal('Manage team member','<form id="gpManageTeamForm"><div class="fields">'+
 '<label class="wide">Display name<input name="name" maxlength="100" value="'+html(memberName(member))+'" required></label>'+
 '<label class="wide">Match older task assignments<select name="legacy"><option value="">No historical match</option>'+
 options.map(x=>'<option value="'+html(x.id)+'" '+(x.id===member.legacy_member_id?'selected':'')+'>'+html(x.name)+'</option>').join('')+
 '</select></label>'+
 (!owner?'<label>Permissions<select name="role"><option value="editor" '+(member.member_role==='editor'?'selected':'')+'>Editor · can make changes</option><option value="viewer" '+(member.member_role==='viewer'?'selected':'')+'>Viewer · read only</option></select></label>':'<p class="sub">Owner permissions cannot be changed here.</p>')+
 '</div><p class="sub">Matching an older assignee keeps their task and time-log IDs. It does not create a duplicate teammate.</p>'+
 '<div class="controls"><button type="button" class="button" id="gpTeamCancel">Cancel</button>'+
 (!owner?'<button type="button" class="button danger" id="gpTeamRemove">Remove access</button>':'')+
 '<button type="submit" class="button main">Save changes</button></div></form>');
 $a('#gpTeamCancel').onclick=closeModal;
 $a('#gpManageTeamForm').onsubmit=async ev=>{
  ev.preventDefault();const button=ev.currentTarget.querySelector('[type=submit]'),values=Object.fromEntries(new FormData(ev.currentTarget));
  button.disabled=true;
  try{
   await window.GamePlanSync.setMemberDetails(id,values.name.trim(),values.legacy||null);
   if(!owner&&values.role!==member.member_role)await window.GamePlanSync.setMemberRole(id,values.role);
   closeModal();await window.GamePlanSync.reloadTeam();render();
  }catch(err){gpAlert('Could not update teammate: '+err.message);button.disabled=false}
 };
 $a('#gpTeamRemove')?.addEventListener('click',async()=>{
  if(!await gpConfirm('Remove this person’s access? Their historical task and hour records will remain.',{confirmLabel:'Remove access',danger:true}))return;
  try{await window.GamePlanSync.removeMemberAccess(id);closeModal();await window.GamePlanSync.reloadTeam()}
  catch(err){gpAlert('Could not remove access: '+err.message)}
 });
}
// Every clickable control gives a brief, persistent pressed-state response,
// including keyboard activation; no navigation or form behavior is changed.
document.addEventListener('click',event=>{
 const button=event.target.closest?.('button,.button,a.button,[role="button"]');
 if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')return;
 button.classList.add('gp-tapped');
 clearTimeout(button.__gpTapTimer);
 button.__gpTapTimer=setTimeout(()=>button.classList.remove('gp-tapped'),280);
},true);
window.GamePlanAccounts={
 showLogin,showWorkspace,requestMigration,emptyWorkspace,hideEmpty,onAuthenticated,accountDialog,
 setTeam,renderTeamPage,teamRole:currentTeamRole,createProjectDialog,loginMessage
};
// The Team tab is driven by Supabase's authenticated gp_members, not the old
// manually entered local names. Historical assignees remain in saved data.
gpTeamPage=function(){renderTeamPage()};

showLogin({configured:!!(function(){try{const x=JSON.parse(localStorage.getItem('gameplan-cloud-config-v1')||'null');return x?.url&&x?.key}catch{return false}})()});
})();