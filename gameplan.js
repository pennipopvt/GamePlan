'use strict';
/* GamePlan extension: project tags, saved templates, analytics and navigation. */
/* GamePlan-styled confirmations and input prompts, layered over editing panels. */
function gpDialog(message,{title='Please confirm',confirmLabel='Continue',danger=false,input=false,initialValue=''}={}){
 return new Promise(resolve=>{
  const old=document.getElementById('gpDialogOverlay');if(old)old.remove();
  const overlay=document.createElement('div');overlay.id='gpDialogOverlay';overlay.className='gp-dialog-backdrop';
  const card=document.createElement('div');card.className='gp-dialog-card';card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');
  const heading=document.createElement('h2');heading.textContent=title;
  const description=document.createElement('p');description.className='gp-dialog-message';description.textContent=String(message);
  const actions=document.createElement('div');actions.className='gp-dialog-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='button';cancel.textContent='Cancel';
  const ok=document.createElement('button');ok.type='button';ok.className=danger?'button danger':'button main';ok.textContent=confirmLabel;
  let field;
  if(input){field=document.createElement('input');field.type='text';field.value=String(initialValue);field.setAttribute('aria-label',title)}
  card.append(heading,description);if(field)card.append(field);actions.append(cancel,ok);card.append(actions);overlay.append(card);document.body.appendChild(overlay);
  const previous=document.activeElement;
  const finish=result=>{document.removeEventListener('keydown',keyHandler,true);overlay.remove();if(previous?.isConnected)previous.focus();resolve(result)};
  const keyHandler=ev=>{if(ev.key==='Escape'){ev.preventDefault();finish(input?null:false)}else if(ev.key==='Enter'&&input){ev.preventDefault();finish(field.value)}};
  document.addEventListener('keydown',keyHandler,true);
  overlay.addEventListener('click',ev=>{if(ev.target===overlay)finish(input?null:false)});
  cancel.onclick=()=>finish(input?null:false);ok.onclick=()=>finish(input?field.value:true);
  (field||ok).focus();if(field)field.select();
 });
}
function gpConfirm(message,options={}){return gpDialog(message,options)}
function gpPrompt(message,initialValue=''){return gpDialog(message,{title:message.split('\n')[0].replace(/:$/,''),confirmLabel:'Continue',input:true,initialValue})}

const GP_COLORS=[{name:'Blue',hex:'#729fd6'},{name:'Pink',hex:'#db8bac'},{name:'Purple',hex:'#ac91d6'},{name:'Yellow',hex:'#d8b56b'},{name:'Green',hex:'#68a992'},{name:'Orange',hex:'#e18b71'},{name:'Gray',hex:'#98aab6'}];
let gpPage='board',gpSelecting=false;
const gpSelected=new Set();
const gpTags=()=>data.tags.filter(x=>x.project_id===activeProject);
const gpTemplates=()=>data.templates.filter(x=>x.project_id===activeProject);
const gpTagBadges=task=>(task.tag_ids||[]).map(id=>gpTags().find(t=>t.tag_id===id)).filter(Boolean).map(t=>'<span class="gp-tag" style="--tc:'+e(t.color)+'">'+e(t.name)+'</span>').join('');
const gpOriginalLoad=loadLocal;
loadLocal=function(){const result=gpOriginalLoad();result.tags=Array.isArray(result.tags)?result.tags:[];result.templates=Array.isArray(result.templates)?result.templates:[];result.custom_tag_colors=Array.isArray(result.custom_tag_colors)?result.custom_tag_colors:[];return result};
data.tags=Array.isArray(data.tags)?data.tags:[];
data.templates=Array.isArray(data.templates)?data.templates:[];
const gpOriginalRow=taskRow;
taskRow=function(t){
 let html=gpOriginalRow(t);
 const tags=(t.tag_ids||[]).map(id=>gpTags().find(tag=>String(tag.tag_id)===String(id))).filter(Boolean);
 const strips=tags.map(tag=>'<span class="gp-tag-rail" style="--tc:'+e(tag.color||'#b18aa6')+'"><span class="gp-tag-rail-mark" aria-hidden="true"></span><span class="gp-tag-rail-name">'+e(tag.name)+'</span></span>').join('');
 const tagMarkup='<div class="gp-task-tags'+(tags.length?'':' gp-no-tags')+'">'+
 (tags.length?'<button type="button" class="gp-tag-peek" aria-label="'+e('Task tags: '+tags.map(tag=>tag.name).join(', '))+'" aria-expanded="false" title="'+e(tags.map(tag=>tag.name).join(', '))+'">'+strips+'</button>':'')+
 '<button type="button" class="gp-tag-add icon-edit" data-gp-tag-add="'+e(t.task_id)+'" aria-label="Add or remove tags for '+e(t.title)+'" title="Add tags">+</button></div>';
 html=html.replace('<div class="meta-person sub">',tagMarkup+'<div class="meta-person sub">');
 if(gpSelecting)html=html.replace(/(<div class="task-entry [^"]*)(")/,(_match,classes,quote)=>classes+' gp-template-selectable'+(gpSelected.has(String(t.task_id))?' gp-template-selected':'')+quote+' data-gp-template-task="'+e(t.task_id)+'" aria-selected="'+String(gpSelected.has(String(t.task_id)))+'"');
 return html;
};
/* Task ordering: drag onto a task to insert before/after, or onto a feature
   header to move into that feature. The data.tasks array is the saved order. */
const gpDragTaskRow=taskRow;
taskRow=function(task){
 let html=gpDragTaskRow(task);
 if(!isPM())return html;
 const handle='<span class="gp-task-drag-handle" draggable="true" data-gp-drag-task="'+e(task.task_id)+'" title="Drag to reorder or move to another feature" aria-label="Drag '+e(task.title)+' to reorder or move" role="img"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="currentColor"><circle cx="8" cy="5" r="1.7"/><circle cx="16" cy="5" r="1.7"/><circle cx="8" cy="12" r="1.7"/><circle cx="16" cy="12" r="1.7"/><circle cx="8" cy="19" r="1.7"/><circle cx="16" cy="19" r="1.7"/></svg></span>';
 return html.replace(/(<div class="task-entry [^"]*">)/, '$1'+handle);
};
const gpOriginalRenderMilestones=renderMilestones;
renderMilestones=function(){gpOriginalRenderMilestones();gpWireTaskDrag()};
let gpDraggingTaskId=null;
function gpWireTaskDrag(){
 const root=$('#milestoneList');
 const clear=()=>{
  gpDraggingTaskId=null;
  root.querySelectorAll('.gp-task-dragging,.gp-feature-drop-target,.gp-task-drop-before,.gp-task-drop-after').forEach(el=>el.classList.remove('gp-task-dragging','gp-feature-drop-target','gp-task-drop-before','gp-task-drop-after'));
 };
 const destination=ev=>{
  const row=ev.target.closest?.('.task-entry');
  const section=ev.target.closest?.('.feature-section[data-feat]');
  const targetFeature=section&&data.features.find(f=>String(f.feature_id)===String(section.dataset.feat));
  const dragged=data.tasks.find(t=>String(t.task_id)===gpDraggingTaskId);
  if(!dragged||!targetFeature||dragged.project_id!==activeProject||targetFeature.project_id!==activeProject)return null;
  const targetTask=row&&data.tasks.find(t=>String(t.task_id)===String(row.querySelector('[data-gp-drag-task]')?.dataset.gpDragTask));
  if(targetTask?.task_id===dragged.task_id)return null;
  if(targetTask&&String(targetTask.feature_id)!==String(targetFeature.feature_id))return null;
  const after=!!(targetTask&&ev.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2);
  return {row:targetTask?row:null,targetTask,targetFeature,after,section};
 };
 root.ondragstart=ev=>{
  const handle=ev.target.closest?.('[data-gp-drag-task]');
  if(!handle||!isPM()||gpSelecting){ev.preventDefault();return}
  const task=data.tasks.find(t=>String(t.task_id)===String(handle.dataset.gpDragTask));
  if(!task||task.project_id!==activeProject){ev.preventDefault();return}
  gpDraggingTaskId=String(task.task_id);
  ev.dataTransfer.effectAllowed='move';
  ev.dataTransfer.setData('text/plain',gpDraggingTaskId);
  handle.closest('.task-entry')?.classList.add('gp-task-dragging');
 };
 root.ondragover=ev=>{
  const dest=destination(ev);
  root.querySelectorAll('.gp-feature-drop-target,.gp-task-drop-before,.gp-task-drop-after').forEach(el=>el.classList.remove('gp-feature-drop-target','gp-task-drop-before','gp-task-drop-after'));
  if(!dest)return;
  ev.preventDefault();ev.dataTransfer.dropEffect='move';
  if(dest.row)dest.row.classList.add(dest.after?'gp-task-drop-after':'gp-task-drop-before');
  else dest.section.classList.add('gp-feature-drop-target');
 };
 root.ondragleave=ev=>{
  const target=ev.target.closest?.('.feature-section[data-feat]');
  if(target&&!target.contains(ev.relatedTarget))target.classList.remove('gp-feature-drop-target');
 };
 root.ondrop=ev=>{
  const dest=destination(ev);
  if(!dest||!isPM()){clear();return}
  ev.preventDefault();ev.stopPropagation();
  const task=data.tasks.find(t=>String(t.task_id)===gpDraggingTaskId);
  const before=[...data.tasks],oldFeature=task.feature_id,oldUpdated=task.updated_at;
  // Preserve relative order of all unrelated tasks, including hidden/filtered ones.
  const reordered=data.tasks.filter(t=>t!==task);
  let position;
  if(dest.targetTask){
   position=reordered.indexOf(dest.targetTask)+(dest.after?1:0);
  }else{
   const indices=reordered.map((t,i)=>String(t.feature_id)===String(dest.targetFeature.feature_id)?i:-1).filter(i=>i>=0);
   position=indices.length?indices[indices.length-1]+1:reordered.length;
  }
  if(position<0)position=reordered.length;
  reordered.splice(position,0,task);
  task.feature_id=dest.targetFeature.feature_id;
  task.updated_at=new Date().toISOString();
  data.tasks=reordered;
  clear();
  try{persist();render()}
  catch(err){data.tasks=before;task.feature_id=oldFeature;task.updated_at=oldUpdated;gpAlert('Could not reorder task: '+err.message);render()}
 };
 root.ondragend=clear;
}
const gpOriginalForm=taskForm;
taskForm=function(t,featureId=''){
 gpOriginalForm(t,featureId);
 const form=$('#actionForm');if(!form)return;
 const area=document.createElement('div');area.className='gp-tag-editor';
 area.innerHTML='<strong>Tags</strong><div class="gp-tag-list">'+(gpTags().map(tag=>'<label><input type="checkbox" name="gp_tag" value="'+e(tag.tag_id)+'" '+((t?.tag_ids||[]).includes(tag.tag_id)?'checked':'')+'><span class="gp-tag" style="--tc:'+e(tag.color)+'">'+e(tag.name)+'</span></label>').join('')||'<p class="sub">Add tags in Project Settings.</p>')+'</div>';
 form.querySelector('.fields').appendChild(area);
};
const gpOriginalRpc=rpc;
rpc=function(op,p={}){
 if(op==='createTask'||op==='editTask'){
  const form=$('#actionForm');
  if(form&&form.querySelector('[name=gp_tag]'))p.tag_ids=[...form.querySelectorAll('[name=gp_tag]:checked')].map(x=>x.value);
 }
 return gpOriginalRpc(op,p).then(result=>{
  if(op==='createTask'||op==='editTask'){
   const t=op==='editTask'?data.tasks.find(t=>String(t.task_id)===String(p.task_id)):data.tasks[data.tasks.length-1];
   if(t){t.tag_ids=p.tag_ids||[];persist()}
  }
  return result;
 });
};
const gpOriginalQuickCreate=quickCreate;
quickCreate=function(kind,preferredMilestoneId=''){
 if(kind==='feature')return gpFeatureCreate(preferredMilestoneId);
 return gpOriginalQuickCreate(kind,preferredMilestoneId);
};
const gpOriginalRender=render;
render=function(){
 gpOriginalRender();
 gpRenderPage();
 gpRenderProjectControls();
 gpDecorateDeletes();
};
function gpNavigate(page){
 // Board is a single destination; clicking it does not toggle subtabs.
 gpPage=page;gpSelected.clear();gpSelecting=false;$('#sidebar').classList.remove('visible');render();
}
function gpAddShell(){
 const sidebar=$('#sidebar');
 sidebar.querySelector('.sidebar-brand').innerHTML='<img class="gp-brand-mark" src="gameplan-mark.svg?v=2026.11.04.24" alt=""><span class="gp-brand-wordmark"><span class="gp-brand-game">Game</span><span class="gp-brand-plan">Plan</span></span>';
 const nav=document.createElement('nav');nav.id='gpPrimary';nav.className='side-nav';
 const gpBoardIcon='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
 const gpGraphIcon='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m6 16 5-6 4 3 5-7"/></svg>';
 const gpBlueprintIcon='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="15" height="18" rx="1.5"/><path d="M6 7h9M6 10h6M6 13h4M6 16h3"/><path d="m13 17 6.5-6.5 2 2L15 19l-3 1z"/></svg>';
 const gpTeamIcon='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v1"/></svg>';
 const gpSettingsIcon='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M10 2h4l.6 2.2 1.8.8 2-.9 2.8 2.8-.9 2 .8 1.8L23 11v4l-2.2.6-.8 1.8.9 2-2.8 2.8-2-.9-1.8.8L14 24h-4l-.6-2.2-1.8-.8-2 .9-2.8-2.8.9-2-.8-1.8L1 15v-4l2.2-.6.8-1.8-.9-2L5.9 3.8l2 .9 1.8-.8L10 2Z" transform="translate(1,1) scale(.9)"/></svg>';
 nav.innerHTML=[['board',gpBoardIcon,'Board'],['analytics',gpGraphIcon,'Analytics'],['templates',gpBlueprintIcon,'Templates'],['team',gpTeamIcon,'Team'],['settings',gpSettingsIcon,'Project Settings']].map(([v,icon,label])=>'<button class="gp-nav" data-page="'+v+'" title="'+label+'"><span class="gp-icon">'+icon+'</span><span class="gp-text">'+label+'</span></button>').join('');
 const sidebarToggle=document.createElement('button');
 sidebarToggle.id='gpSidebarToggle';sidebarToggle.type='button';sidebarToggle.className='gp-sidebar-toggle';
 sidebarToggle.innerHTML='<span aria-hidden="true">☰</span><span class="gp-toggle-text">Collapse sidebar</span>';
 sidebarToggle.setAttribute('aria-label','Collapse sidebar');
 const projectSwitcher=document.createElement('div');projectSwitcher.id='gpProjectSwitcher';
 projectSwitcher.innerHTML='<button id="gpProjectTrigger" class="gp-project-trigger" type="button" aria-haspopup="dialog" aria-label="Switch project" title="Switch project"><svg class="gp-project-switch-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h14m-4-4 4 4-4 4M17 17H3m4-4-4 4 4 4"/></svg></button>';
 const logo=sidebar.querySelector('.sidebar-brand');
 const topRow=document.createElement('div');topRow.id='gpSidebarTop';
 logo.before(topRow);topRow.append(sidebarToggle,logo);
 topRow.after(projectSwitcher,nav);
 const trigger=$('#gpProjectTrigger');
 trigger.onclick=gpOpenProjectDialog;

 const header=$('.workspace .top');
 const titleWrap=document.createElement('div');titleWrap.className='gp-header-project';
 titleWrap.innerHTML='<div class="gp-project-overline"><label for="gpProjectTitle" class="gp-project-label">CURRENT PROJECT</label></div><div class="gp-project-title-line"><input id="gpProjectTitle" aria-label="Edit current project name" autocomplete="off" spellcheck="false" title="Click to rename project"></div>';
 const oldHeader=header.firstElementChild;
 const versionLabel=$('#appVersion');
 const mobileToggle=$('#menuToggle');
 header.prepend(mobileToggle,titleWrap);
 titleWrap.querySelector('.gp-project-title-line').prepend(projectSwitcher);
 oldHeader.remove();
 $('#gpProjectTitle').addEventListener('change',gpRenameProjectInline);
 $('#gpProjectTitle').addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();ev.currentTarget.blur()}if(ev.key==='Escape'){ev.currentTarget.value=find(data.projects,activeProject,'project_id')?.project_name||'';ev.currentTarget.blur()}});

const main=$('#mainApp');const board=document.createElement('div');board.id='gpBoardView';while(main.firstChild)board.append(main.firstChild);main.append(board);
 const pageHeader=document.createElement('header');pageHeader.id='gpSecondaryPageHeader';pageHeader.className='gp-secondary-page-header';
 pageHeader.innerHTML='<h1 id="gpSecondaryPageTitle"></h1>';
 pageHeader.hidden=true;main.append(pageHeader);
 const extra=document.createElement('section');extra.id='gpExtra';extra.className='card';main.append(extra);
 const headerActions=document.createElement('div');headerActions.className='gp-header-actions';
 headerActions.setAttribute('aria-label','Import and export');
 for(const id of ['export','import','importMilestone','fileInput','milestoneFileInput']){
  const control=document.getElementById(id);
  if(control)headerActions.appendChild(control);
 }
 header.appendChild(headerActions);
 // Keep legacy controls available to existing handlers without showing a Board Tools panel.
 const legacyActions=$('.top-actions');
 if(legacyActions){legacyActions.hidden=true;legacyActions.style.display='none';main.append(legacyActions)}
 const siteFooter=document.createElement('footer');siteFooter.className='gp-site-footer';
 siteFooter.innerHTML='<p>Local projects, teams, and hours · Saved in this browser</p>';
 const version=document.createElement('p');version.appendChild(versionLabel);
 siteFooter.appendChild(version);
 main.append(siteFooter);
 const selectButton=document.createElement('button');selectButton.id='gpSelectTasks';selectButton.className='button';selectButton.textContent='Create Template';$('#pmActions').after(selectButton);
 const bar=document.createElement('div');bar.id='gpSelectionBar';bar.hidden=true;$('#milestoneList').before(bar);
 $('#gpPrimary').onclick=ev=>{const b=ev.target.closest('[data-page]');if(b)gpNavigate(b.dataset.page)};
 $('#gpSelectTasks').onclick=()=>{gpSelecting=!gpSelecting;gpSelected.clear();renderMilestones();gpSelectionBar()};
 $('#milestoneList').addEventListener('click',ev=>{
  if(!gpSelecting)return;
  const row=ev.target.closest('.gp-template-selectable[data-gp-template-task]');
  if(!row||!$('#milestoneList').contains(row)||ev.target.closest('select,input,textarea,.gp-task-drag-handle,[data-gp-delete],.actions,.icon-edit'))return;
  ev.preventDefault();ev.stopImmediatePropagation();
  const id=String(row.dataset.gpTemplateTask);
  if(gpSelected.has(id))gpSelected.delete(id);else gpSelected.add(id);
  row.classList.toggle('gp-template-selected',gpSelected.has(id));
  row.setAttribute('aria-selected',String(gpSelected.has(id)));
  gpSelectionBar();
 },true);
 const setSidebarState=collapsed=>{
  document.querySelector('.app').classList.toggle('gp-collapsed',collapsed);
  sidebarToggle.setAttribute('aria-expanded',String(!collapsed));
  sidebarToggle.setAttribute('aria-label',collapsed?'Expand sidebar':'Collapse sidebar');
  sidebarToggle.querySelector('.gp-toggle-text').textContent=collapsed?'Expand sidebar':'Collapse sidebar';
  $('#menuToggle').setAttribute('aria-expanded',String(!collapsed));
  try{localStorage.setItem('gp-collapsed',collapsed?'1':'0')}catch{}
 };
 sidebarToggle.onclick=()=>{
  if(innerWidth<=680){sidebar.classList.remove('visible');return}
  setSidebarState(!document.querySelector('.app').classList.contains('gp-collapsed'));
 };
 $('#menuToggle').onclick=()=>{sidebar.classList.toggle('visible');$('#menuToggle').setAttribute('aria-expanded',String(sidebar.classList.contains('visible')))};
 try{if(localStorage.getItem('gp-collapsed')==='1')setSidebarState(true)}catch{}
}
function gpSelectionBar(){
 const bar=$('#gpSelectionBar');bar.hidden=!gpSelecting;
 $('#gpSelectTasks').textContent=gpSelecting?'Cancel Template':'Create Template';
 if(!gpSelecting)return;
 bar.innerHTML='<div class="gp-flex"><span>Click tasks to select them · '+gpSelected.size+' selected</span><button class="button main" id="gpSaveSelection" '+(gpSelected.size?'':'disabled')+'>Save as Template</button></div>';
 $('#gpSaveSelection').onclick=gpSaveTemplate;
}
function gpRenderPage(){
 $('#gpBoardView').hidden=gpPage!=='board';
 $('#gpExtra').hidden=gpPage==='board';
 const secondaryHeader=$('#gpSecondaryPageHeader');
 secondaryHeader.hidden=gpPage==='board';
 if(gpPage!=='board')$('#gpSecondaryPageTitle').textContent=({analytics:'Analytics',templates:'Feature Templates',team:'Project Team',settings:'Project Settings'})[gpPage]||'';
document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===gpPage));
 gpSelectionBar();
 if(gpPage==='settings')gpSettings();
 if(gpPage==='analytics')gpAnalytics();
 if(gpPage==='templates')gpTemplatesPage();
 if(gpPage==='team')gpTeamPage();
}
function gpSettings(){
 const project=find(data.projects,activeProject,'project_id');
 $('#gpExtra').innerHTML='<div class="gp-flex"><div class="gp-page-card-spacer"></div><button class="button" id="gpRename">Edit project name</button></div><h2>Project Tags</h2><p class="sub">Tags can be assigned to multiple tasks. For analytics, the first tag receives the logged time so hours are not counted twice.</p><div class="gp-list" id="gpTags">'+gpTags().map(t=>'<div class="gp-card gp-flex"><span class="gp-tag" style="--tc:'+e(t.color)+'">'+e(t.name)+'</span><div class="actions"><button class="button" data-tag-edit="'+e(t.tag_id)+'">Edit</button><button class="button danger" data-tag-delete="'+e(t.tag_id)+'">Delete</button></div></div>').join('')+'</div><p><button class="button main" id="gpAddTag">+ Add tag</button></p><section class="gp-danger-zone"><h2>Danger Zone</h2><p class="sub">Permanently delete this project, including its milestones, features, tasks, time logs, tags, templates and team memberships. Other projects will stay intact.</p><button type="button" class="button danger" id="gpDeleteProject">Delete project</button></section>';
 $('#gpRename').onclick=async()=>{const name=await gpPrompt('Project name',project.project_name);if(name?.trim()){project.project_name=name.trim();persist();render()}};
 $('#gpAddTag').onclick=()=>gpEditTag();
 $('#gpDeleteProject').onclick=gpDeleteProject;
 $('#gpTags').onclick=ev=>{const a=ev.target.closest('[data-tag-edit]'),b=ev.target.closest('[data-tag-delete]');if(a)gpEditTag(a.dataset.tagEdit);if(b)gpDeleteTag(b.dataset.tagDelete)};
}
function gpColorToHSV(hex){
 const n=parseInt(hex.replace('#',''),16),r=((n>>16)&255)/255,g=((n>>8)&255)/255,b=(n&255)/255;
 const hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo;
 let h=0;if(d){if(hi===r)h=((g-b)/d)%6;else if(hi===g)h=(b-r)/d+2;else h=(r-g)/d+4;h=(h*60+360)%360}
 return {h,s:hi?d/hi:0,v:hi};
}
function gpHSVToColor(h,s,v){
 const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;
 const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
 return '#'+rgb.map(k=>Math.round((k+m)*255).toString(16).padStart(2,'0')).join('');
}
// Shared swatch palette and HSV picker for Project Tags and Team chart colors.
// One implementation means both dialogs use identical selection and custom-color behavior.
function gpNormalizeHexColor(value){
 const hex=String(value||'').trim().replace(/^#/,'');
 if(/^[a-f0-9]{3}$/i.test(hex))return '#'+[...hex.toLowerCase()].map(c=>c+c).join('');
 if(/^[a-f0-9]{6}$/i.test(hex))return '#'+hex.toLowerCase();
 return null;
}
function gpRememberPaletteColor(value){
 const color=gpNormalizeHexColor(value);
 if(!color)throw Error('Choose a valid hex color');
 if(GP_COLORS.some(c=>c.hex.toLowerCase()===color))return;
 if(!Array.isArray(data.custom_tag_colors))data.custom_tag_colors=[];
 if(!data.custom_tag_colors.some(c=>c.project_id===activeProject&&c.color.toLowerCase()===color))
  data.custom_tag_colors.push({project_id:activeProject,color});
}
function gpColorPaletteMarkup(selected,label){
 const defaults=GP_COLORS.map(c=>c.hex);
 const saved=(data.custom_tag_colors||[]).filter(c=>c.project_id===activeProject).map(c=>c.color);
 const palette=[...new Set([...defaults,...saved,...(selected?[selected]:[])])];
 const tile=color=>'<label class="gp-color-tile" data-gp-color="'+e(color)+'" title="'+(defaults.includes(color)?'Default color':'Right-click to delete custom color')+'" aria-label="Select '+e(color)+'"><input type="radio" name="color" value="'+e(color)+'" '+(selected===color?'checked':'')+'><span class="gp-color-fill" style="background:'+e(color)+'"></span></label>';
 const picker='<div id="gpInlinePicker" class="gp-inline-picker" hidden><div class="gp-picker-sv" id="gpPickerSV" role="slider" aria-label="Saturation and brightness" tabindex="0"><div class="gp-picker-sv-cursor" id="gpPickerCursor"></div></div><div class="gp-picker-hue-row"><div class="gp-hue-track"><input type="range" id="gpPickerHue" min="0" max="360" value="0" aria-label="Hue"></div><span id="gpPickerSwatch" class="gp-picker-swatch"></span></div><div class="gp-picker-actions"><button type="button" class="button" id="gpPickerCancel">Cancel</button><button type="button" class="button main" id="gpPickerConfirm">Add Color</button></div></div>';
 return '<div class="wide gp-member-palette"><strong>'+e(label)+'</strong><div class="gp-color-grid" id="gpColorGrid">'+palette.map(tile).join('')+'<button type="button" class="gp-color-add" id="gpOpenPicker" title="Add custom color" aria-label="Add custom color">+</button></div>'+
 '<div class="gp-hex-color-row"><label for="gpHexColor">Hex code</label><input id="gpHexColor" type="text" spellcheck="false" autocomplete="off" maxlength="7" placeholder="#RRGGBB" value="'+e(selected.toUpperCase())+'" aria-describedby="gpHexHelp"><span class="sub" id="gpHexHelp">#RRGGBB or #RGB</span></div>'+
 '<div class="gp-palette-tools"><button type="button" class="button" id="gpClearColors">Clear custom colors</button><span class="sub">Right-click a custom square to delete it.</span></div>'+
 '<div class="gp-color-context" id="gpColorContext" hidden><button type="button" id="gpDeleteColor">Delete color</button></div>'+picker+'</div>';
}
function gpSetupColorPalette(form,selected,preview){
 const defaults=GP_COLORS.map(c=>c.hex);
 const grid=form.querySelector('#gpColorGrid'),panel=form.querySelector('#gpInlinePicker'),sv=form.querySelector('#gpPickerSV'),hue=form.querySelector('#gpPickerHue'),context=form.querySelector('#gpColorContext'),hex=form.querySelector('#gpHexColor');
 const checked=()=>form.querySelector('[name=color]:checked')?.value||selected;
 const tile=color=>'<label class="gp-color-tile" data-gp-color="'+e(color)+'" title="'+(defaults.includes(color)?'Default color':'Right-click to delete custom color')+'" aria-label="Select '+e(color)+'"><input type="radio" name="color" value="'+e(color)+'"><span class="gp-color-fill" style="background:'+e(color)+'"></span></label>';
 let draft=gpColorToHSV(selected),contextColor=null;
 const redraw=()=>{
  sv.style.backgroundColor=gpHSVToColor(draft.h,1,1);
  form.querySelector('#gpPickerCursor').style.left=(draft.s*100)+'%';
  form.querySelector('#gpPickerCursor').style.top=((1-draft.v)*100)+'%';
  form.querySelector('#gpPickerSwatch').style.backgroundColor=gpHSVToColor(draft.h,draft.s,draft.v);
 };
 const selectColor=(value,updateHex=true)=>{
  const color=gpNormalizeHexColor(value);if(!color)return false;
  let radio=[...grid.querySelectorAll('[name=color]')].find(r=>r.value.toLowerCase()===color);
  if(!radio){
   form.querySelector('#gpOpenPicker').insertAdjacentHTML('beforebegin',tile(color));
   radio=[...grid.querySelectorAll('[name=color]')].find(r=>r.value.toLowerCase()===color);
  }
  radio.checked=true;
  if(updateHex)hex.value=color.toUpperCase();
  hex.setCustomValidity('');hex.setAttribute('aria-invalid','false');
  preview(color);
  return true;
 };
 const validateHex=()=>{
  const valid=!!gpNormalizeHexColor(hex.value);
  hex.setCustomValidity(valid?'':'Enter a color such as #AABBCC or #ABC');
  hex.setAttribute('aria-invalid',String(!valid));
  return valid;
 };
 hex.addEventListener('input',()=>{
  const color=gpNormalizeHexColor(hex.value);
  validateHex();
  if(color)selectColor(color,false);
 });
 grid.addEventListener('change',ev=>{
  if(ev.target.matches('[name=color]'))selectColor(ev.target.value);
 });
 const closeContext=()=>{context.hidden=true;contextColor=null};
 const removeCustomColor=color=>{
  data.custom_tag_colors=(data.custom_tag_colors||[]).filter(c=>!(c.project_id===activeProject&&c.color===color));
  const matching=[...grid.querySelectorAll('[data-gp-color]')].find(el=>el.dataset.gpColor===color);
  if(matching){const wasSelected=matching.querySelector('input').checked;matching.remove();if(wasSelected){const fallback=grid.querySelector('[name=color]');if(fallback)fallback.checked=true}}
  closeContext();persist();selectColor(checked());
 };
 grid.addEventListener('contextmenu',ev=>{
  const target=ev.target.closest('[data-gp-color]');if(!target)return;
  const color=target.dataset.gpColor;if(defaults.includes(color))return;
  ev.preventDefault();contextColor=color;context.hidden=false;
  const bounds=form.getBoundingClientRect();
  context.style.left=Math.max(0,Math.min(ev.clientX-bounds.left,bounds.width-145))+'px';
  context.style.top=Math.max(0,ev.clientY-bounds.top+8)+'px';
 });
 form.querySelector('#gpDeleteColor').onclick=()=>{if(contextColor)removeCustomColor(contextColor)};
 form.addEventListener('click',ev=>{if(!ev.target.closest('#gpColorContext')&&!ev.target.closest('[data-gp-color]'))closeContext()});
 form.querySelector('#gpClearColors').onclick=async()=>{
  const custom=[...grid.querySelectorAll('[data-gp-color]')].filter(el=>!defaults.includes(el.dataset.gpColor));
  if(!custom.length){gpAlert('There are no custom colors to clear.');return}
  if(!await gpConfirm('Clear all custom colors from this project’s palette? Saved tag and team colors will stay unchanged.',{danger:true,confirmLabel:'Clear colors'}))return;
  data.custom_tag_colors=(data.custom_tag_colors||[]).filter(c=>c.project_id!==activeProject);
  const wasCustom=!defaults.includes(checked());custom.forEach(el=>el.remove());
  if(wasCustom){const fallback=grid.querySelector('[name=color]');if(fallback)fallback.checked=true}
  closeContext();persist();selectColor(checked());
 };
 form.querySelector('#gpOpenPicker').onclick=()=>{
  draft=gpColorToHSV(checked());hue.value=String(Math.round(draft.h));redraw();panel.hidden=false;
 };
 form.querySelector('#gpPickerCancel').onclick=()=>{panel.hidden=true};
 hue.oninput=()=>{draft.h=Number(hue.value);redraw()};
 const updateSV=ev=>{
  const bounds=sv.getBoundingClientRect();
  draft.s=Math.max(0,Math.min(1,(ev.clientX-bounds.left)/bounds.width));
  draft.v=1-Math.max(0,Math.min(1,(ev.clientY-bounds.top)/bounds.height));redraw();
 };
 sv.addEventListener('pointerdown',ev=>{sv.setPointerCapture(ev.pointerId);updateSV(ev)});
 sv.addEventListener('pointermove',ev=>{if(ev.buttons===1&&sv.hasPointerCapture(ev.pointerId))updateSV(ev)});
 sv.addEventListener('keydown',ev=>{
  const step=ev.shiftKey?.1:.025;
  if(ev.key==='ArrowLeft')draft.s=Math.max(0,draft.s-step);
  else if(ev.key==='ArrowRight')draft.s=Math.min(1,draft.s+step);
  else if(ev.key==='ArrowUp')draft.v=Math.min(1,draft.v+step);
  else if(ev.key==='ArrowDown')draft.v=Math.max(0,draft.v-step);
  else return;ev.preventDefault();redraw();
 });
 form.querySelector('#gpPickerConfirm').onclick=()=>{
  const color=gpHSVToColor(draft.h,draft.s,draft.v);
  selectColor(color);
  if(!data.custom_tag_colors)data.custom_tag_colors=[];
  if(!defaults.includes(color)&&!data.custom_tag_colors.some(c=>c.project_id===activeProject&&c.color===color)){
   data.custom_tag_colors.push({project_id:activeProject,color});persist();
  }
  panel.hidden=true;
 };
 form.addEventListener('input',ev=>{if(ev.target!==hex)preview(checked())});
 form.addEventListener('change',ev=>{if(ev.target!==hex)preview(checked())});
 preview(checked());
 const selectedColor=()=>{if(!validateHex()){hex.reportValidity();return null}return checked()};
 selectedColor.remember=()=>{const color=selectedColor();if(color)gpRememberPaletteColor(color);return color};
 return selectedColor;
}
function gpMemberManageColorMarkup(memberId){
 const selected=window.GamePlanColors?.getColor?.(memberId)||GP_COLORS[0].hex;
 return '<details class="gp-manage-member-color wide"><summary class="gp-manage-member-color-summary">Chart color <span id="gpManageColorSwatch" class="gp-team-color-swatch" style="background:'+e(selected)+'"></span></summary>'+
  '<div class="gp-manage-member-color-body">'+gpColorPaletteMarkup(selected,'Choose color')+'</div></details>';
}
function gpSetupMemberManageColor(form,memberId){
 const selected=window.GamePlanColors?.getColor?.(memberId)||GP_COLORS[0].hex;
 return gpSetupColorPalette(form,selected,color=>{
  const swatch=form.querySelector('#gpManageColorSwatch');
  if(swatch)swatch.style.backgroundColor=color;
 });
}
function gpEditTag(id=''){
 const tag=gpTags().find(t=>t.tag_id===id),selected=tag?.color||GP_COLORS[0].hex;
 modal(tag?'Edit tag':'Add tag','<form id="actionForm"><div class="fields">'+field('name','Tag name',tag?.name||'','text',true)+
  gpColorPaletteMarkup(selected,'Tag color')+
  '<div class="wide gp-color-preview"><span class="sub">Preview</span> <span id="gpPreviewTag" class="gp-tag"></span></div></div>'+
  '<div class="controls"><button type="button" class="button" id="gpCancel">Cancel</button><button type="submit" class="button main">Save tag</button></div></form>');
 $('#gpCancel').onclick=closeModal;
 const form=$('#actionForm');
 const selectedColor=gpSetupColorPalette(form,selected,color=>{
  $('#gpPreviewTag').style.setProperty('--tc',color);
  $('#gpPreviewTag').textContent=form.querySelector('[name=name]').value.trim()||'New tag';
 });
 form.onsubmit=ev=>{
  ev.preventDefault();
  const name=String(new FormData(form).get('name')||'').trim();if(!name)return;
  if(gpTags().some(t=>t.name.toLowerCase()===name.toLowerCase()&&t!==tag)){gpAlert('Tag name already exists');return}
  const color=selectedColor();if(!color)return;
  selectedColor.remember();
  if(tag){tag.name=name;tag.color=color}else data.tags.push({tag_id:uid(),project_id:activeProject,name,color});
  persist();closeModal();render();
 };
}
async function gpDeleteTag(id){
 const tag=gpTags().find(t=>t.tag_id===id);if(!tag||!await gpConfirm('Delete '+tag.name+'? Tasks and templates will retain all other data.',{danger:true,confirmLabel:'Delete tag'}))return;
 data.tags=data.tags.filter(t=>t!==tag);
 data.tasks.forEach(t=>t.tag_ids=(t.tag_ids||[]).filter(x=>x!==id));
 data.templates.forEach(t=>t.tasks.forEach(item=>item.tag_ids=(item.tag_ids||[]).filter(x=>x!==id)));
 persist();render();
}
async function gpSaveTemplate(){
 const selected=projectTasks().filter(t=>gpSelected.has(String(t.task_id)));if(!selected.length)return;
 const unfinished=selected.filter(t=>t.status!=='Done');
 if(unfinished.length&&!await gpConfirm(unfinished.length+' selected tasks are unfinished. Use their existing estimates instead of their logged time?',{confirmLabel:'Use existing estimates'}))return;
 const name=await gpPrompt('Template name');if(!name?.trim())return;
 const tasks=selected.map(t=>({title:t.title,description:t.description||'',priority:t.priority||'Normal',tag_ids:[...(t.tag_ids||[])],estimated_hours:t.status==='Done'?Math.ceil(Math.round(taskHours(t)*60)/10)*10/60:Number(t.estimated_hours||0)}));
 data.templates.push({template_id:uid(),project_id:activeProject,name:name.trim(),tasks});persist();gpNavigate('templates');
}
function gpTemplatesPage(){
 $('#gpExtra').innerHTML='<div class="gp-flex"><div class="gp-page-card-spacer"></div><button class="button main" id="gpChoose">+ Select tasks</button></div><div class="gp-list" id="gpTemplateList">'+gpTemplates().map(t=>'<div class="gp-card gp-flex"><div><h3>'+e(t.name)+'</h3><p class="sub">'+t.tasks.length+' tasks · '+formatHours(t.tasks.reduce((s,x)=>s+Number(x.estimated_hours||0),0))+' estimated</p></div><div class="actions"><button class="button" data-t-edit="'+e(t.template_id)+'">Edit</button><button class="button danger" data-t-delete="'+e(t.template_id)+'">Delete</button><button class="button main" data-t-use="'+e(t.template_id)+'">Use template</button></div></div>').join('')+'</div>';
 $('#gpChoose').onclick=()=>{gpNavigate('board');gpSelecting=true;renderMilestones();gpSelectionBar()};
 $('#gpTemplateList').onclick=async ev=>{const a=ev.target.closest('[data-t-edit]'),b=ev.target.closest('[data-t-delete]'),c=ev.target.closest('[data-t-use]');if(a)gpEditTemplate(a.dataset.tEdit);if(b){const t=gpTemplates().find(x=>x.template_id===b.dataset.tDelete);if(t&&await gpConfirm('Delete '+t.name+'?',{danger:true,confirmLabel:'Delete template'})){data.templates=data.templates.filter(x=>x!==t);persist();render()}}if(c)gpUseTemplate(c.dataset.tUse)};
}
function gpTaskEditRow(task){
 return '<div class="gp-template-task"><label>Task title<input name="task_title" required value="'+e(task.title||'')+'"></label><label>Description<textarea name="task_description">'+e(task.description||'')+'</textarea></label><label>Estimate (minutes)<input type="number" min="0" step="1" name="task_minutes" value="'+Math.round(Number(task.estimated_hours||0)*60)+'"></label><label>Priority<select name="task_priority">'+PRI.map(x=>'<option '+(x===(task.priority||'Normal')?'selected':'')+'>'+x+'</option>').join('')+'</select></label><label>Tags<select name="task_tags" multiple size="3">'+gpTags().map(t=>'<option value="'+e(t.tag_id)+'" '+((task.tag_ids||[]).includes(t.tag_id)?'selected':'')+'>'+e(t.name)+'</option>').join('')+'</select></label><button class="button danger" type="button" data-remove-template-task>Remove task</button></div>';
}
function gpEditTemplate(id){
 const t=gpTemplates().find(x=>x.template_id===id);if(!t)return;
 modal('Edit feature template','<form id="actionForm">'+field('name','Template name',t.name,'text',true)+'<div id="gpTemplateRows">'+t.tasks.map(gpTaskEditRow).join('')+'</div><div class="controls"><button class="button" type="button" id="gpAddTemplateTask">+ Task</button><button class="button" type="button" id="gpCancel">Cancel</button><button class="button main" type="submit">Save template</button></div></form>');
 $('#gpCancel').onclick=closeModal;$('#gpAddTemplateTask').onclick=()=>$('#gpTemplateRows').insertAdjacentHTML('beforeend',gpTaskEditRow({}));
 $('#gpTemplateRows').onclick=ev=>{if(ev.target.closest('[data-remove-template-task]'))ev.target.closest('.gp-template-task').remove()};
 $('#actionForm').onsubmit=ev=>{ev.preventDefault();const name=ev.currentTarget.elements.name.value.trim();if(!name)return;
 const rows=[...$('#gpTemplateRows').querySelectorAll('.gp-template-task')],tasks=rows.map(row=>({title:row.querySelector('[name=task_title]').value.trim(),description:row.querySelector('[name=task_description]').value,priority:row.querySelector('[name=task_priority]').value,estimated_hours:Math.max(0,Number(row.querySelector('[name=task_minutes]').value)||0)/60,tag_ids:[...row.querySelector('[name=task_tags]').selectedOptions].map(o=>o.value)}));
 if(tasks.some(task=>!task.title)){gpAlert('Task titles cannot be blank.');return}t.name=name;t.tasks=tasks;persist();closeModal();render()};
}
function gpFeatureCreate(preferredMilestoneId='',initialTemplateId=''){
 const ms=data.milestones.filter(m=>m.project_id===activeProject),templates=gpTemplates();
 if(!ms.length){gpAlert('Create a milestone first.');return}
 const defaultMilestone=ms.find(m=>String(m.milestone_id)===String(preferredMilestoneId))?.milestone_id||ms[0].milestone_id;
 const usingTemplate=Boolean(initialTemplateId&&templates.some(t=>t.template_id===initialTemplateId));
 const sourceOptions='<label class="wide">Create feature<select name="creation_source"><option value="blank" '+(!usingTemplate?'selected':'')+'>Blank feature</option>'+ (templates.length?'<option value="template" '+(usingTemplate?'selected':'')+'>Add from template</option>':'')+'</select></label>';
 const templateOptions='<label class="wide" id="gpTemplateChoice">Choose template<select name="template_id">'+templates.map(t=>'<option value="'+e(t.template_id)+'" '+(t.template_id===initialTemplateId?'selected':'')+'>'+e(t.name)+' ('+t.tasks.length+' tasks)</option>').join('')+'</select></label>';
 const defaultName=usingTemplate?templates.find(t=>t.template_id===initialTemplateId)?.name||'':'';
 modal('Create feature','<form id="actionForm"><div class="fields">'+sourceOptions+templateOptions+field('name','New feature name',defaultName,'text',true)+select('milestone_id','Milestone',opts(ms,'milestone_id'),defaultMilestone,true)+'</div><div class="controls"><button type="button" class="button" id="gpCancel">Cancel</button><button type="submit" class="button main">Create feature</button></div></form>');
 const form=$('#actionForm'),source=form.elements.creation_source,templateField=$('#gpTemplateChoice');
 const sync=()=>{templateField.hidden=source.value!=='template'};
 const selectedTemplate=()=>templates.find(t=>t.template_id===form.elements.template_id?.value);
 source.onchange=()=>{sync();if(source.value==='template'&&!form.elements.name.value.trim())form.elements.name.value=selectedTemplate()?.name||''};
 form.elements.template_id?.addEventListener('change',()=>{if(source.value==='template')form.elements.name.value=selectedTemplate()?.name||''});
 sync();$('#gpCancel').onclick=closeModal;
 form.onsubmit=async ev=>{
  ev.preventDefault();
  const name=String(form.elements.name.value||'').trim(),mid=String(form.elements.milestone_id.value);
  if(!name||!ms.some(m=>String(m.milestone_id)===mid))return;
  const button=form.querySelector('button[type=submit]');button.disabled=true;
  try{
   if(source.value==='blank'){
    await rpc('createFeature',{project_id:activeProject,milestone_id:mid,name});
   }else{
    const template=selectedTemplate();if(!template)throw Error('Select a template first');
    const fid=uid();
    data.features.push({feature_id:fid,project_id:activeProject,milestone_id:mid,name,description:'',status:'To do',...(gpDraftMilestone(mid)?{__gp_private:true}:{})});
    for(const original of template.tasks){
     const h=Number(original.estimated_hours)||0;
     data.tasks.push({task_id:uid(),project_id:activeProject,feature_id:fid,title:original.title,description:original.description||'',tag_ids:[...(original.tag_ids||[])],priority:original.priority||'Normal',assignee_member_id:'',status:'To do',estimated_hours:h,created_by_member_id:data.me.member_id,updated_at:'',...(gpDraftMilestone(mid)?{__gp_private:true}:{})});
    }
    persist();
   }
   closeModal();gpNavigate('board');
  }catch(err){gpAlert('Could not create feature: '+err.message);button.disabled=false}
 };
}
function gpUseTemplate(id){gpFeatureCreate('',id)}

async function gpDeleteProject(){
 const p=find(data.projects,activeProject,'project_id');if(!p)return;
 const id=p.project_id,shared=!!window.GamePlanSync?.isLinked?.(id);
 if(shared&&window.GamePlanSync.roleFor(id)!=='owner'){
  gpAlert('Only the project owner can permanently delete a shared project.');return;
 }
 if(shared&&!navigator.onLine){
  gpAlert('Connect to the internet to delete this shared project safely.');return;
 }
 const ms=data.milestones.filter(x=>x.project_id===id),fs=data.features.filter(x=>x.project_id===id),tasks=data.tasks.filter(x=>x.project_id===id);
 const taskIds=new Set(tasks.map(x=>String(x.task_id)));
 const logs=data.logs.filter(x=>taskIds.has(String(x.task_id)));
 const summary='Delete project “'+p.project_name+'”?\n\nThis will permanently delete:\n• '+ms.length+' milestones\n• '+fs.length+' features\n• '+tasks.length+' tasks\n• '+logs.length+' time entries\n• '+gpTags().length+' tags\n• '+gpTemplates().length+' templates\n\n'+(shared?'Everyone will lose access to this project. The cloud copy and its invitations will be deleted. ':'')+'Other projects will not be changed. This cannot be undone.';
 if(!await gpConfirm(summary,{title:'Delete entire project?',danger:true,confirmLabel:'Continue'}))return;
 const typed=await gpPrompt('Type the project name to confirm deletion','');
 if(typed!==p.project_name){if(typed!==null)gpAlert('Project name did not match. Nothing was deleted.');return}
 // A recovery snapshot is created BEFORE the remote delete; any failure
 // leaves the live cloud project and current browser board unchanged.
 const backup={project:p,milestones:ms,features:fs,tasks,logs,
  team:data.team.filter(x=>x.project_id===id),
  tags:data.tags.filter(x=>x.project_id===id),templates:data.templates.filter(x=>x.project_id===id),
  custom_tag_colors:(data.custom_tag_colors||[]).filter(x=>x.project_id===id),
  saved_at:new Date().toISOString()};
 try{localStorage.setItem('gp-pre-project-delete-'+id+'-'+Date.now(),JSON.stringify(backup))}
 catch(err){gpAlert('Could not save a recovery backup. The project was NOT deleted: '+err.message);return}
 if(shared){
  try{await window.GamePlanSync.deleteSharedProject(id)}
  catch(err){gpAlert('Cloud project was not deleted: '+err.message);return}
 }
 const previous=data,previousProject=activeProject;
 data={...data,
  projects:data.projects.filter(x=>x.project_id!==id),
  milestones:data.milestones.filter(x=>x.project_id!==id),
  features:data.features.filter(x=>x.project_id!==id),
  tasks:data.tasks.filter(x=>x.project_id!==id),
  logs:data.logs.filter(x=>!taskIds.has(String(x.task_id))),
  team:data.team.filter(x=>x.project_id!==id),
  memberships:data.memberships.filter(x=>x.project_id!==id),
  tags:data.tags.filter(x=>x.project_id!==id),
  templates:data.templates.filter(x=>x.project_id!==id),
  custom_tag_colors:(data.custom_tag_colors||[]).filter(x=>x.project_id!==id)
 };
 try{persist()}catch(err){
  data=previous;activeProject=previousProject;
  gpAlert('Cloud deletion succeeded, but the local board could not be updated. Recovery backup saved. '+err.message);
  return;
 }
 activeProject=data.projects[0]?.project_id||'';
 gpMilestoneSelection='';gpSelected.clear();gpSelecting=false;
 $('#assigneeFilter').value='';$('#searchTasks').value='';
 saveProject();
 if(data.projects.length)gpNavigate('board');
 else{window.GamePlanAccounts?.emptyWorkspace?.();$('#mainApp').hidden=true;}
 gpAlert('Project deleted. Recovery backup saved on this browser.');
}

function gpSwitchProject(id){
 if(!data.projects.some(p=>String(p.project_id)===String(id)))return;
 activeProject=id;gpMilestoneSelection='';gpMyOnly=false;gpSelected.clear();gpSelecting=false;saveProject();
 $('#assigneeFilter').value='';$('#searchTasks').value='';
 render();
}
function gpRenameProjectInline(){
 const input=$('#gpProjectTitle'),project=find(data.projects,activeProject,'project_id');if(!project)return;
 const name=input.value.trim();if(!name){input.value=project.project_name;gpAlert('Project name cannot be empty.');return}
 if(name===project.project_name)return;
 project.project_name=name;persist();render();
}
function gpRenderProjectControls(){
 const project=find(data.projects,activeProject,'project_id');
 const title=$('#gpProjectTitle');
 if(title&&document.activeElement!==title)title.value=project?.project_name||'';
}
function gpOpenProjectDialog(){
 const rows=data.projects.map(p=>
  '<button type="button" class="gp-project-choice" data-gp-project="'+e(p.project_id)+'" aria-current="'+(String(p.project_id)===String(activeProject))+'">'+
   '<span>'+e(p.project_name)+'</span>'+
   (String(p.project_id)===String(activeProject)?'<span class="gp-choice-current">Current project ✓</span>':'')+
  '</button>'
 ).join('');
 modal('Switch Project','<p class="sub">Choose a project to open, or create a new one.</p><div class="gp-project-chooser">'+rows+'</div><button type="button" class="gp-project-chooser-create" id="gpProjectCreate">+ Create Project</button>');
 const body=$('#modalBody');
 body.querySelectorAll('[data-gp-project]').forEach(btn=>btn.addEventListener('click',()=>{
  const id=btn.dataset.gpProject;
  closeModal();
  gpSwitchProject(id);
 }));
 body.querySelector('#gpProjectCreate').onclick=()=>{closeModal();quickCreate('project')};
 body.addEventListener('keydown',ev=>{if(ev.key==='Escape'){ev.preventDefault();closeModal();$('#gpProjectTrigger').focus()}});
 (body.querySelector('[aria-current="true"]')||body.querySelector('[data-gp-project]'))?.focus();
}

function gpTeamPage(){
 const memberships=(data.team||[]).filter(m=>m.project_id===activeProject);
 const roster=data.roster||data.members;
 $('#gpExtra').innerHTML='<div class="gp-flex"><div class="gp-page-card-spacer"></div><button id="gpAddMember" class="button main">+ Add member</button></div><div id="gpTeamRows" class="gp-list">'+memberships.map(m=>{
  const person=roster.find(p=>String(p.member_id)===String(m.member_id))||data.members.find(p=>String(p.member_id)===String(m.member_id));
  const name=person?.display_name||'Unknown';
  const avatar=window.GamePlanAvatars?.markup?.(m.member_id,name,'team')||'';
  return '<div class="gp-card gp-flex gp-team-local-row">'+avatar+'<div class="gp-team-person-copy"><strong>'+e(name)+'</strong><div class="sub">'+e(m.project_role||'Member')+(m.discipline?' · '+e(m.discipline):'')+'</div></div>'+
  '<button type="button" class="button" data-gp-member="'+e(m.member_id)+'">Manage</button></div>';
 }).join('')+'</div>';
 $('#gpAddMember').onclick=()=>quickCreate('member');
 $('#gpTeamRows').onclick=ev=>{const btn=ev.target.closest('[data-gp-member]');if(btn)editMember(btn.dataset.gpMember)};
}
const gpTrashSVG='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7"/></svg>';
function gpDecorateDeletes(){
 const root=$('#milestoneList');if(!root)return;
 const targets=[['[data-milestone]','milestone'],['[data-feature]','feature'],['[data-edit]','task']];
 for(const [selector,kind] of targets){
  root.querySelectorAll(selector).forEach(editButton=>{
   const id=editButton.dataset[kind==='task'?'edit':kind],name=kind==='milestone'?find(data.milestones,id,'milestone_id')?.name:kind==='feature'?find(data.features,id,'feature_id')?.name:find(data.tasks,id,'task_id')?.title;
   if(!name||editButton.parentElement.querySelector('[data-gp-delete="'+kind+':'+id+'"]'))return;
   const button=document.createElement('button');
   button.type='button';button.className='icon-edit gp-delete-icon';button.dataset.gpDelete=kind+':'+id;
   button.title='Delete '+kind;button.setAttribute('aria-label','Delete '+kind+': '+name);button.innerHTML=gpTrashSVG;
   editButton.after(button);
  });
 }
}
$('#milestoneList').addEventListener('click',ev=>{
 const button=ev.target.closest('[data-gp-delete]');if(!button)return;
 ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
 const [kind,id]=button.dataset.gpDelete.split(':');
 const object=kind==='milestone'?find(data.milestones,id,'milestone_id'):kind==='feature'?find(data.features,id,'feature_id'):find(data.tasks,id,'task_id');
 if(object&&object.project_id===activeProject)deleteItem(kind,id,object.name||object.title);
},true);

/* Session-local undo/redo for saved changes. Typing keeps native browser undo. */
const gpUndoStack=[],gpRedoStack=[],gpHistoryLimit=40;
const gpSavedPersist=persist;
persist=function(){
 const previous=localStorage.getItem(LOCAL_KEY);
 const next=JSON.stringify(data);
 gpSavedPersist();
 if(previous!==null&&previous!==next){
  gpUndoStack.push(previous);
  if(gpUndoStack.length>gpHistoryLimit)gpUndoStack.shift();
  gpRedoStack.length=0;
 }
 gpUpdateHistoryControls();
};
function gpUpdateHistoryControls(){
 const back=$('#gpUndoAction'),forward=$('#gpRedoAction');
 if(back){back.disabled=!gpUndoStack.length;back.title=gpUndoStack.length?'Undo last saved change (Ctrl+Z)':'No changes to undo'}
 if(forward){forward.disabled=!gpRedoStack.length;forward.title=gpRedoStack.length?'Redo last undone change (Ctrl+Shift+Z)':'No changes to redo'}
}
function gpHistoryNavigate(direction){
 const undo=direction==='undo',source=undo?gpUndoStack:gpRedoStack,destination=undo?gpRedoStack:gpUndoStack;
 if(!source.length)return;
 const previous=source.pop(),current=localStorage.getItem(LOCAL_KEY)||JSON.stringify(data);
 try{
  const restored=normalizeLocal(JSON.parse(previous));
  localStorage.setItem(LOCAL_KEY,previous);
  destination.push(current);
  if(destination.length>gpHistoryLimit)destination.shift();
  data=restored;
  if(!data.projects.some(p=>p.project_id===activeProject)){
   activeProject=data.projects[0]?.project_id||'';
   saveProject();
  }
  closeModal();
  render();
 }catch(err){source.push(previous);gpAlert('Could not restore change: '+err.message)}
 gpUpdateHistoryControls();
}
function gpSetupHistoryControls(){
 const area=document.querySelector('.gp-header-actions');
 if(!area)return;
 const undo=document.createElement('button'),redo=document.createElement('button');
 undo.type='button';undo.id='gpUndoAction';undo.className='button';undo.textContent='↶ Undo';
 redo.type='button';redo.id='gpRedoAction';redo.className='button';redo.textContent='↷ Redo';
 area.prepend(undo,redo);
 undo.onclick=()=>gpHistoryNavigate('undo');
 redo.onclick=()=>gpHistoryNavigate('redo');
 document.addEventListener('keydown',ev=>{
  if(!(ev.ctrlKey||ev.metaKey)||ev.altKey||ev.key.toLowerCase()!=='z')return;
  const target=ev.target;
  if(target?.closest?.('input, textarea, [contenteditable="true"], [role="textbox"]'))return;
  if(document.querySelector('#gpDialogOverlay')||!$('#back').classList.contains('hidden')&&getComputedStyle($('#back')).display!=='none')return;
  const direction=ev.shiftKey?'redo':'undo';
  if((direction==='undo'?gpUndoStack:gpRedoStack).length){
   ev.preventDefault();gpHistoryNavigate(direction);
  }
 });
 gpUpdateHistoryControls();
}
/* Animate native details height without replacing their controls or saved open states. */
function gpSetupHierarchyAnimation(){
 const root=$('#milestoneList');
 root.addEventListener('click',ev=>{
  const summary=ev.target.closest?.('summary');
  const el=summary?.parentElement;
  if(!summary||!el?.matches('details[data-ms],details[data-feat]')||!root.contains(el))return;
  if(ev.target.closest('button,a,input,select,[role="button"]'))return;
  ev.preventDefault();
  if(el.dataset.gpAnimating==='1')return;
  const opening=!el.open;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches||typeof el.animate!=='function'){
   el.open=opening;
   return;
  }
  const summaryHeight=summary.getBoundingClientRect().height;
  const startHeight=opening?summaryHeight:el.getBoundingClientRect().height;
  if(opening)el.open=true;
  const endHeight=opening?el.scrollHeight:summaryHeight;
  el.dataset.gpAnimating='1';
  el.classList.add('gp-details-animating');
  const animation=el.animate(
   [{height:startHeight+'px'},{height:endHeight+'px'}],
   {duration:210,easing:'cubic-bezier(.22,.68,.25,1)'}
  );
  const finish=()=>{
   if(!opening)el.open=false;
   el.classList.remove('gp-details-animating');
   delete el.dataset.gpAnimating;
  };
  animation.onfinish=finish;
  animation.oncancel=finish;
 },true);
}

/* Faceted deckbuilder filters: OR within category, AND across categories. */
const gpFacets={person:new Set(),tag:new Set(),status:new Set(),priority:new Set()};
const gpExcludedFacets=Object.fromEntries(Object.keys(gpFacets).map(key=>[key,new Set()]));
const gpFacetGroups=[
 {key:'person',title:'Assignees'},
 {key:'tag',title:'Tags'},
 {key:'status',title:'Status'},
 {key:'priority',title:'Priority'}
];
const gpHasFacetFilters=()=>gpFacetGroups.some(group=>gpFacets[group.key].size||gpExcludedFacets[group.key].size);
function gpFacetOptions(key){
 const tasks=projectTasks();
 if(key==='person'){
  const roster=projectMembers().map(p=>({id:String(p.member_id),name:p.display_name}));
  if(tasks.some(t=>!t.assignee_member_id))roster.push({id:'__unassigned',name:'Unassigned'});
  return roster;
 }
 if(key==='tag')return [
  ...gpTags().map(t=>({id:String(t.tag_id),name:t.name,color:t.color})),
  {id:'__untagged',name:'Untagged',color:'#a6adb8'}
 ];
 if(key==='status')return ST.map((name,i)=>({id:name,name,color:['#a6adb8','#7775cf','#d94b58','#32956d'][i]}));
 if(key==='priority')return PRI.map(name=>({id:name,name}));
 return [];
}
/* Filters: OR for included options within a category, AND between categories.
   Excluded options always hide matching tasks. */
function gpTaskFacetValues(task,key){
 const f=feature(task.feature_id);
 if(key==='person')return [String(task.assignee_member_id||'__unassigned')];
 if(key==='tag')return (task.tag_ids||[]).length?task.tag_ids.map(String):['__untagged'];
 if(key==='status')return [String(task.status||'To do')];
 if(key==='priority')return [String(task.priority||'Normal')];
 return [];
}
const gpBaseVisibleTasks=visibleTasks;
visibleTasks=function(){
 return gpBaseVisibleTasks().filter(task=>gpFacetGroups.every(group=>{
  const values=gpTaskFacetValues(task,group.key);
  const included=gpFacets[group.key],excluded=gpExcludedFacets[group.key];
  if(values.some(id=>excluded.has(id)))return false;
  return !included.size||values.some(id=>included.has(id));
 }));
};
function gpResetFacets(){
 for(const group of gpFacetGroups){
  gpFacets[group.key].clear();
  gpExcludedFacets[group.key].clear();
 }
}
function gpRenderFacetControls(){
 const panel=$('#gpFilterPanel'),button=$('#gpFilterTrigger'),chips=$('#gpFilterChips'),count=$('#gpFilterCount');
 if(!panel||!button||!chips||!count)return;
 const chosen=[];
 for(const group of gpFacetGroups){
  for(const option of gpFacetOptions(group.key)){
   if(gpFacets[group.key].has(option.id))chosen.push({key:group.key,id:option.id,label:option.name,group:group.title});
   if(gpExcludedFacets[group.key].has(option.id))chosen.push({key:group.key,id:option.id,label:option.name,group:'Exclude '+group.title.toLowerCase(),excluded:true});
  }
 }
 const total=chosen.length;
 count.textContent=String(total);count.hidden=total===0;
 chips.hidden=total===0;
 chips.innerHTML=chosen.map(o=>'<button type="button" class="gp-filter-chip'+(o.excluded?' gp-filter-chip-excluded':'')+'" data-gp-remove-key="'+e(o.key)+'" data-gp-remove-id="'+e(o.id)+'" data-gp-remove-mode="'+(o.excluded?'exclude':'include')+'" aria-label="Remove '+e(o.group+': '+o.label)+'">'+e(o.group)+': '+e(o.label)+' <span aria-hidden="true">×</span></button>').join('')+(total?'<button type="button" class="gp-filter-clear" id="gpClearAllChips">Clear all</button>':'');
 panel.innerHTML='<div class="gp-filter-panel-header"><strong>Filter tasks</strong><button type="button" class="gp-filter-clear" id="gpClearFilters">Clear all</button></div>'+
  gpFacetGroups.map(group=>{
   const opts=gpFacetOptions(group.key);
   return '<section class="gp-filter-group"><div class="gp-filter-group-heading">'+e(group.title)+'</div><div class="gp-filter-choices">'+
    (opts.length?opts.map(o=>{
     const excluded=gpExcludedFacets[group.key].has(o.id),included=gpFacets[group.key].has(o.id);
     const state=excluded?'Excluded':included?'Included':'Unselected';
     return '<button type="button" class="gp-filter-choice'+(excluded?' gp-filter-excluded':'')+'" data-gp-facet="'+e(group.key)+'" data-gp-id="'+e(o.id)+'" aria-pressed="'+String(included||excluded)+'" aria-label="'+e(group.title+': '+o.name+', '+state)+'" title="'+e(state+': '+o.name)+'">'+(o.color?'<span class="gp-filter-dot" style="--gp-dot:'+e(o.color)+'"></span>':'')+e(o.name)+(excluded?'<span class="gp-filter-state" aria-hidden="true">−</span>':included?'<span class="gp-filter-state" aria-hidden="true">✓</span>':'')+'</button>';
    }).join(''):'<span class="sub">None yet</span>')+'</div></section>';
  }).join('')+'<button type="button" class="gp-filter-clear" id="gpManageTags">Manage tags in Project Settings</button>';
}
function gpSetupFacetEvents(){
 const root=$('#gpFilterPanel'),trigger=$('#gpFilterTrigger'),chips=$('#gpFilterChips');
 const close=()=>{root.hidden=true;trigger.setAttribute('aria-expanded','false')};
 trigger.addEventListener('click',()=>{
  const opening=root.hidden;
  root.hidden=!opening;trigger.setAttribute('aria-expanded',String(opening));
 });
 root.addEventListener('click',ev=>{
  // Render replaces clicked buttons. Avoid the outside-click listener closing the menu.
  ev.stopPropagation();
  const choice=ev.target.closest('[data-gp-facet]');
  if(choice){
   const key=choice.dataset.gpFacet,id=choice.dataset.gpId;
   if(!Object.hasOwn(gpFacets,key))return;
   const included=gpFacets[key],excluded=gpExcludedFacets[key];
   if(included.has(id)){included.delete(id);excluded.add(id)}
   else if(excluded.has(id))excluded.delete(id);
   else included.add(id);
   render();return;
  }
  if(ev.target.closest('#gpClearFilters')){gpResetFacets();render();return}
  if(ev.target.closest('#gpManageTags')){close();gpNavigate('settings')}
 });
 chips.addEventListener('click',ev=>{
  const remove=ev.target.closest('[data-gp-remove-key]');
  if(remove){
   const key=remove.dataset.gpRemoveKey,id=remove.dataset.gpRemoveId;
   (remove.dataset.gpRemoveMode==='exclude'?gpExcludedFacets[key]:gpFacets[key])?.delete(id);
   render();return;
  }
  if(ev.target.closest('#gpClearAllChips')){gpResetFacets();render()}
 });
 document.addEventListener('click',ev=>{
  if(!ev.target.closest('.gp-filter-wrap'))close();
 });
 document.addEventListener('keydown',ev=>{
  if(ev.key==='Escape'&&!root.hidden){close();trigger.focus()}
 });
}
const gpPreviousSwitchProject=gpSwitchProject;
gpSwitchProject=function(id){gpResetFacets();gpPreviousSwitchProject(id)};
const gpPreviousRenderWithFacets=render;
render=function(){gpPreviousRenderWithFacets();gpRenderFacetControls()};

/* Task tag picker: one-click chips, with a quick-create field in the task dialog. */
const gpPriorTaskFormWithTags=taskForm;
taskForm=function(t,featureId=''){
 gpPriorTaskFormWithTags(t,featureId);
 const area=$('#actionForm .gp-tag-editor');
 if(!area)return;
 const existing=new Set((t?.tag_ids||[]).map(String));
 const options=()=>gpTags().map(tag=>
  '<label class="gp-tag-chip" style="--tc:'+e(tag.color||'#db8bac')+'">'+
  '<input type="checkbox" name="gp_tag" value="'+e(tag.tag_id)+'" '+(existing.has(String(tag.tag_id))?'checked':'')+'>'+
  '<span class="gp-tag-indicator" aria-hidden="true"></span>'+
  '<span class="gp-tag">'+e(tag.name)+'</span><span class="gp-tag-check" aria-hidden="true">✓</span></label>'
 ).join('');
 area.innerHTML='<div class="gp-tag-heading"><strong>Tags</strong><button type="button" class="gp-tag-add-inline" id="gpTagQuickToggle">+ New tag</button></div>'+
  '<div class="gp-tag-list" id="gpTaskTagOptions">'+(options()||'<span class="sub">No tags yet. Add one below.</span>')+'</div>'+
  '<div class="gp-tag-quick" id="gpTagQuickForm" hidden><input type="text" id="gpNewTagName" maxlength="60" placeholder="New tag name" aria-label="New tag name"><button type="button" class="button main" id="gpQuickCreateTag">Add</button></div>';
 const field=area.querySelector('#gpNewTagName');
 area.querySelector('#gpTagQuickToggle').onclick=()=>{
  const quick=area.querySelector('#gpTagQuickForm');quick.hidden=!quick.hidden;if(!quick.hidden)field.focus();
 };
 const makeTag=()=>{
  const name=field.value.trim();
  if(!name)return;
  const already=gpTags().find(tag=>tag.name.toLowerCase()===name.toLowerCase());
  if(already){
   const checkbox=[...area.querySelectorAll('[name="gp_tag"]')].find(el=>el.value===String(already.tag_id));
   if(checkbox)checkbox.checked=true;
  }else{
   const color=GP_COLORS[gpTags().length%GP_COLORS.length]?.hex||'#db8bac';
   const tag={tag_id:uid(),project_id:activeProject,name,color};
   data.tags.push(tag);
   try{persist()}catch(err){data.tags.pop();gpAlert(err.message);return}
   area.querySelectorAll('[name="gp_tag"]:checked').forEach(el=>existing.add(String(el.value)));
   existing.add(String(tag.tag_id));
   area.querySelector('#gpTaskTagOptions').innerHTML=options();
  }
  field.value='';area.querySelector('#gpTagQuickForm').hidden=true;
 };
 area.querySelector('#gpQuickCreateTag').onclick=makeTag;
 field.addEventListener('keydown',ev=>{if(ev.key==='Enter'){ev.preventDefault();makeTag()}});
};
gpSetupFacetEvents();
/* Keep compact tag strips open for touch/keyboard; hovering expands them with CSS. */
const gpTaskList=$('#milestoneList');

/* Quick tag assignment, including tasks with no existing tags. */
function gpOpenQuickTags(taskId){
 const task=data.tasks.find(t=>String(t.task_id)===String(taskId)&&t.project_id===activeProject);
 if(!task)return;
 const palette=gpTags();
 const marked=new Set((task.tag_ids||[]).map(String));
 const html='<div class="gp-quick-tag-picker"><p class="sub">Select any tags for this task. Changes save immediately.</p>'+
 (palette.length?palette.map(tag=>
  '<button type="button" class="gp-quick-tag-option" data-quick-tag="'+e(tag.tag_id)+'" aria-pressed="'+marked.has(String(tag.tag_id))+'">'+
  '<span class="gp-quick-tag-color" style="--tc:'+e(tag.color||'#b18aa6')+'"></span><span>'+e(tag.name)+'</span><span class="gp-quick-tag-check">'+(marked.has(String(tag.tag_id))?'✓':'+')+'</span></button>'
 ).join(''):'<p class="sub">No tags in this project yet.</p>')+
 '<div class="gp-quick-tag-new"><input type="text" id="gpQuickTagName" placeholder="Create a new tag…" maxlength="60" aria-label="New tag name"><button class="button" type="button" id="gpQuickTagCreate">Create</button></div></div>';
 modal('Tags · '+task.title,html);
 const root=$('#modalBody');
 root.querySelectorAll('[data-quick-tag]').forEach(btn=>btn.onclick=()=>{
  const id=btn.dataset.quickTag;
  const old=[...(task.tag_ids||[])];const set=new Set(old.map(String));
  if(set.has(id))set.delete(id);else set.add(id);
  task.tag_ids=[...set];
  try{persist()}catch(err){task.tag_ids=old;gpAlert('Unable to save tag: '+err.message);return}
  btn.setAttribute('aria-pressed',String(set.has(id)));
  btn.querySelector('.gp-quick-tag-check').textContent=set.has(id)?'✓':'+';
  render();
 });
 const input=root.querySelector('#gpQuickTagName');
 const create=()=>{
  const name=input.value.trim();if(!name)return;
  const existing=gpTags().find(t=>t.name.toLowerCase()===name.toLowerCase());
  if(existing){
   if(!(task.tag_ids||[]).some(id=>String(id)===String(existing.tag_id))){
    const old=[...(task.tag_ids||[])];task.tag_ids=[...old,existing.tag_id];
    try{persist()}catch(err){task.tag_ids=old;gpAlert(err.message);return}
   }
  }else{
   const newTag={tag_id:uid(),project_id:activeProject,name,color:GP_COLORS[gpTags().length%GP_COLORS.length]?.hex||'#db8bac'};
   data.tags.push(newTag);task.tag_ids=[...(task.tag_ids||[]),newTag.tag_id];
   try{persist()}catch(err){data.tags.pop();task.tag_ids=task.tag_ids.filter(id=>id!==newTag.tag_id);gpAlert(err.message);return}
  }
  render();gpOpenQuickTags(taskId);
 };
 root.querySelector('#gpQuickTagCreate').onclick=create;
 input.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();create()}};
}
gpTaskList.addEventListener('click',ev=>{
 const add=ev.target.closest('[data-gp-tag-add]');
 if(!add)return;
 ev.preventDefault();ev.stopPropagation();
 gpOpenQuickTags(add.dataset.gpTagAdd);
},true);
gpTaskList.addEventListener('click',ev=>{
 const trigger=ev.target.closest('.gp-tag-peek');
 if(!trigger)return;
 ev.preventDefault();
 ev.stopPropagation();
 const row=trigger.closest('.task-entry'),open=!row.classList.contains('gp-tags-open');
 gpTaskList.querySelectorAll('.gp-tags-open').forEach(item=>{
  item.classList.remove('gp-tags-open');
  item.querySelector('.gp-tag-peek')?.setAttribute('aria-expanded','false');
 });
 row.classList.toggle('gp-tags-open',open);
 trigger.setAttribute('aria-expanded',String(open));
},true);
document.addEventListener('click',ev=>{
 if(ev.target.closest('.gp-task-tags'))return;
 gpTaskList.querySelectorAll('.gp-tags-open').forEach(row=>{
  row.classList.remove('gp-tags-open');
  row.querySelector('.gp-tag-peek')?.setAttribute('aria-expanded','false');
 });
});
document.addEventListener('keydown',ev=>{
 if(ev.key!=='Escape')return;
 const open=gpTaskList.querySelector('.gp-tags-open');
 if(open){open.classList.remove('gp-tags-open');const btn=open.querySelector('.gp-tag-peek');btn?.setAttribute('aria-expanded','false');btn?.focus()}
});

/* Analytics: grouped vertical bars by person or primary task tag, daily or weekly.
   A log counts once: multi-tag tasks use their first tag, so hours never double-count.
   Person colors live on the synced project team record. */
const gpAnalyticsSettings={project:'',milestone:'all',interval:'week',range:'8',group:'person',velocity:true,featureSort:'newest'};
const gpAnalyticsPalette=['#c63f96','#7364bb','#319b87','#e0a151','#4f87b7','#bf5e62','#8b75a3','#46786e','#d481bc','#79919c'];
const gpSafeColor=value=>/^#[0-9a-f]{6}$/i.test(String(value||''))?String(value).toLowerCase():null;
function gpMemberColor(id){
 const m=data.team.find(t=>String(t.project_id)===String(activeProject)&&String(t.member_id)===String(id));
 if(gpSafeColor(m?.chart_color))return gpSafeColor(m.chart_color);
 // Stable palette assignment for teammates without an explicitly selected color.
 // A deterministic fallback does not shift when new members join. Assign a
 // custom color in Team settings to guarantee distinct chosen colors.
 let hash=0;for(const c of String(id))hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;
 return gpAnalyticsPalette[hash%gpAnalyticsPalette.length];
}
function gpSetMemberColor(memberId,color){
 const value=gpSafeColor(color),id=String(memberId);
 if(!value)throw Error('Choose a valid team color');
 if(!window.GamePlanAuth?.canEdit?.(activeProject)){gpAlert('Only project editors can change team colors.');return false}
 let row=data.team.find(t=>String(t.project_id)===String(activeProject)&&String(t.member_id)===id);
 if(!row){
  row={project_id:activeProject,member_id:id,project_role:'Member',membership_status:'Active',discipline:''};
  data.team.push(row);
 }
 // Convert a transient authenticated-team shadow into an ordinary synchronized
 // team row. Cloud item identity is the existing member_id.
 if(row.__gp_account_shadow)delete row.__gp_account_shadow;
 if(!data.members.some(m=>String(m.member_id)===id)){
  const name=member(id)||id;
  const person={member_id:id,display_name:name,google_email:'',active:'Yes'};
  data.members.push(person);
  if(Array.isArray(data.roster))data.roster.push({...person});
 }
 row.chart_color=value;
 persist();
 render();
 return true;
}
function gpAccountMemberId(row){
 return String(row.legacy_member_id||(row.member_role==='owner'?data.projects.find(p=>p.project_id===activeProject)?.project_manager_member_id:null)||'account:'+row.member_user_id);
}
window.GamePlanColors={getColor:gpMemberColor,setColor:gpSetMemberColor,accountMemberId:gpAccountMemberId,manageMarkup:gpMemberManageColorMarkup,setupManage:gpSetupMemberManageColor,rememberPalette:gpRememberPaletteColor};

// Discord avatars are public image URLs already supplied by the account's
// OAuth metadata. We do not fetch Discord APIs, expose private metadata, or
// trust arbitrary image hosts. No avatar URL is stored in project task rows.
const gpAvatarUrlAllowlist=new Set(['cdn.discordapp.com','media.discordapp.net']);
function gpValidDiscordAvatarUrl(value){
 try{
  const parsed=new URL(String(value||''));
  if(parsed.protocol!=='https:'||!gpAvatarUrlAllowlist.has(parsed.hostname.toLowerCase()))return '';
  if(!/^\/(?:avatars\/|embed\/avatars\/)/.test(parsed.pathname))return '';
  return parsed.href;
 }catch{return ''}
}
const gpAvatarCacheByProject=new Map();
function gpSetTeamAvatars(projectId,rows,currentUser){
 const project=data.projects.find(p=>String(p.project_id)===String(projectId));
 const cache=new Map();
 const own=gpValidDiscordAvatarUrl(currentUser?.user_metadata?.avatar_url||currentUser?.user_metadata?.picture);
 for(const row of rows||[]){
  const memberId=String(row.legacy_member_id||(row.member_role==='owner'?project?.project_manager_member_id:null)||'account:'+row.member_user_id);
  const avatar=gpValidDiscordAvatarUrl(row.avatar_url)||(String(row.member_user_id)===String(currentUser?.id)?own:'');
  if(!avatar)continue;
  cache.set(memberId,avatar);
  cache.set('account:'+row.member_user_id,avatar);
 }
 gpAvatarCacheByProject.set(String(projectId),cache);
}
function gpMemberAvatarMarkup(memberId,displayName,size='board'){
 const name=String(displayName||'').trim();
 const first=Array.from(name)[0]?.toUpperCase()||'?';
 const avatar=gpAvatarCacheByProject.get(String(activeProject))?.get(String(memberId))||'';
 const color=gpMemberColor(memberId);
 const cssClass=size==='team'?'gp-member-avatar gp-member-avatar-team':'gp-member-avatar gp-member-avatar-board';
 return '<span class="'+cssClass+'" style="--gp-member-color:'+e(color)+'" title="'+e(name)+'">'+
  '<span class="gp-member-avatar-initial">'+e(first)+'</span>'+
  (avatar?'<img class="gp-member-avatar-image" src="'+e(avatar)+'" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">':'')+
  '</span>';
}
// An unavailable or outdated Discord image falls back to the initial,
// while retaining the chosen color border.
document.addEventListener('error',event=>{
 if(event.target?.matches?.('img.gp-member-avatar-image'))event.target.remove();
},true);
window.GamePlanAvatars={
 markup:gpMemberAvatarMarkup,
 setTeam:gpSetTeamAvatars,
 urlFor:memberId=>gpAvatarCacheByProject.get(String(activeProject))?.get(String(memberId))||'',
 clear:()=>gpAvatarCacheByProject.clear()
};

function gpAnalyticsDate(raw){
 const match=String(raw||'').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
 if(!match)return '';
 const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]),date=new Date(Date.UTC(y,m-1,d));
 return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?date.toISOString().slice(0,10):'';
}
function gpAnalyticsWeekStart(raw){
 const iso=gpAnalyticsDate(raw);if(!iso)return '';
 const date=new Date(iso+'T00:00:00Z');
 date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
 return date.toISOString().slice(0,10);
}
function gpAnalyticsPeriod(date){
 return gpAnalyticsSettings.interval==='day'?gpAnalyticsDate(date):gpAnalyticsWeekStart(date);
}
function gpAnalyticsScope(){
 const features=data.features.filter(f=>f.project_id===activeProject&&(gpAnalyticsSettings.milestone==='all'||String(f.milestone_id)===gpAnalyticsSettings.milestone));
 const ids=new Set(features.map(f=>String(f.feature_id)));
 const tasks=projectTasks().filter(t=>ids.has(String(t.feature_id)));
 const taskMap=new Map(tasks.map(t=>[String(t.task_id),t]));
 const members=new Map(projectMembers().map(p=>[String(p.member_id),String(p.display_name)]));
 const tags=gpTags();
 const allTags=new Map(tags.map(t=>[String(t.tag_id),{id:String(t.tag_id),name:t.name,color:gpSafeColor(t.color)||'#98aab6'}]));
 const logs=[],undated=[];
 for(const log of data.logs){
  const task=taskMap.get(String(log.task_id));if(!task)continue;
  const hours=Number(log.hours);
  if(!Number.isFinite(hours)||hours<=0)continue;
  const memberId=String(log.member_id||'unknown');
  if(!members.has(memberId))members.set(memberId,memberId==='unknown'?'Unknown':member(memberId));
  const firstTag=String((task.tag_ids||[])[0]||'__untagged');
  const tagId=allTags.has(firstTag)?firstTag:'__untagged';
  const date=gpAnalyticsDate(log.work_date||log.date||log.created_at);
  const row={date,period:gpAnalyticsPeriod(date),hours,memberId,tagId};
  if(date)logs.push(row);else undated.push(row);
 }
 const loggedMemberIds=new Set(logs.map(row=>row.memberId));
 const people=[...members].filter(([id])=>projectMembers().some(p=>String(p.member_id)===id)||loggedMemberIds.has(id)).map(([id,name])=>({id,name,color:gpMemberColor(id)}));
 const tagIds=new Set(logs.map(log=>log.tagId));
 const series=gpAnalyticsSettings.group==='tag'
  ?[...allTags.values(),{id:'__untagged',name:'Untagged',color:'#98aab6'}].filter(tag=>tagIds.has(tag.id))
  :people;
 return {features,tasks,logs,undated,series,people};
}
function gpAnalyticsPeriods(rows){
 const today=new Date(),todayLocal=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
 const current=gpAnalyticsPeriod(todayLocal);
 const logged=rows.map(row=>row.period).filter(Boolean).sort();
 const step=gpAnalyticsSettings.interval==='day'?86400000:604800000;
 const limit=gpAnalyticsSettings.range;
 const end=limit==='all'&&logged.length&&logged[logged.length-1]>current?logged[logged.length-1]:current;
 const endMs=Date.parse(end+'T00:00:00Z');
 const earliest=limit==='all'&&logged.length?logged[0]:new Date(endMs-(Number(limit)-1)*step).toISOString().slice(0,10);
 const count=Math.max(1,Math.floor((endMs-Date.parse(earliest+'T00:00:00Z'))/step)+1);
 return Array.from({length:count},(_,i)=>new Date(Date.parse(earliest+'T00:00:00Z')+i*step).toISOString().slice(0,10));
}
function gpAnalyticsGroupedData(scope){
 const periods=gpAnalyticsPeriods(scope.logs),periodMap=new Map(periods.map(period=>[period,new Map()]));
 const active=new Set(scope.series.map(s=>s.id));
 for(const log of scope.logs){
  const bucket=periodMap.get(log.period),id=gpAnalyticsSettings.group==='tag'?log.tagId:log.memberId;
  if(!bucket||!active.has(id))continue;
  bucket.set(id,(bucket.get(id)||0)+log.hours);
 }
 const rows=periods.map((period,index)=>{
  const values=scope.series.map(s=>periodMap.get(period).get(s.id)||0);
  return {period,index,values,total:values.reduce((sum,n)=>sum+n,0)};
 });
 const window=gpAnalyticsSettings.interval==='day'?7:3;
 const line=rows.map((row,i)=>rows.slice(Math.max(0,i-window+1),i+1).reduce((sum,r)=>sum+r.total,0)/Math.min(window,i+1));
 return {rows,line,window};
}
function gpAnalyticsHoursTick(value){
 const minutes=Math.round(value*60),hours=Math.floor(minutes/60),remainder=minutes%60;
 return remainder?(hours?hours+'h'+String(remainder).padStart(2,'0'):remainder+'m'):hours+'h';
}
function gpAnalyticsChart(scope,grouped){
 const rows=grouped.rows,series=scope.series;
 if(!rows.some(row=>row.total>0))return '<div class="gp-analytics-no-data"><strong>No logged time in this range yet.</strong><p>Choose a different milestone or time range, or log time on a task.</p></div>';
 const isDaily=gpAnalyticsSettings.interval==='day';
 const width=Math.max(740,rows.length*Math.max(isDaily?60:95,series.length*19+28)+85);
 const height=330,left=55,right=25,top=22,bottom=57,plotHeight=height-top-bottom,plotWidth=width-left-right,step=plotWidth/rows.length;
 const peak=Math.max(1,...rows.flatMap(row=>row.values),...(gpAnalyticsSettings.velocity?grouped.line:[]));
 const ceiling=Math.max(1,Math.ceil(peak/2)*2),toY=value=>top+plotHeight-(value/ceiling)*plotHeight;
 const grid=Array.from({length:5},(_,i)=>{
  const value=ceiling*i/4,y=toY(value);
  return '<line x1="'+left+'" y1="'+y+'" x2="'+(width-right)+'" y2="'+y+'" stroke="#eee8ee"/>'+
   '<text x="'+(left-10)+'" y="'+(y+4)+'" text-anchor="end" font-size="11" fill="#8f8391">'+e(gpAnalyticsHoursTick(value))+'</text>';
 }).join('');
 const bars=rows.map((row,i)=>{
  const gap=series.length>5?2:4;
  const groupWidth=Math.min(step*.84,series.length*23+14);
  const barWidth=Math.max(3,Math.min(23,(groupWidth-Math.max(0,series.length-1)*gap)/Math.max(1,series.length)));
  const used=series.length*barWidth+Math.max(0,series.length-1)*gap,x0=left+i*step+step/2-used/2;
  return row.values.map((value,j)=>{
   if(value<=0)return '';
   const y=toY(value);
   return '<rect x="'+(x0+j*(barWidth+gap)).toFixed(2)+'" y="'+y.toFixed(2)+'" width="'+barWidth.toFixed(2)+'" height="'+(top+plotHeight-y).toFixed(2)+'" rx="2" fill="'+e(series[j].color)+'">'+
    '<title>'+e(series[j].name)+' · '+e(row.period)+' · '+formatHours(value)+'</title></rect>';
  }).join('');
 }).join('');
 const labels=rows.map((row,i)=>{
  const date=new Date(row.period+'T00:00:00Z'),label=date.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
  return '<text x="'+(left+i*step+step/2).toFixed(2)+'" y="'+(height-bottom+25)+'" text-anchor="middle" font-size="11.5" fill="#746a78">'+e(label)+'</text>';
 }).join('');
 const average=gpAnalyticsSettings.velocity?('<polyline points="'+grouped.line.map((v,i)=>(left+i*step+step/2).toFixed(2)+','+toY(v).toFixed(2)).join(' ')+'" fill="none" stroke="#3e2a45" stroke-width="2.7" stroke-linejoin="round"/>'+
  grouped.line.map((v,i)=>'<circle cx="'+(left+i*step+step/2).toFixed(2)+'" cy="'+toY(v).toFixed(2)+'" r="3.3" fill="#fff" stroke="#3e2a45" stroke-width="2">'+
   '<title>'+grouped.window+'-'+(isDaily?'day':'week')+' average · '+e(rows[i].period)+' · '+formatHours(v)+'</title></circle>').join('')):'';
 const legend=series.map(s=>'<span class="gp-analytics-legend-item"><i style="background:'+e(s.color)+'"></i>'+e(s.name)+'</span>').join('')+
  (gpAnalyticsSettings.velocity?'<span class="gp-analytics-legend-item"><i class="gp-analytics-line-key"></i>Team hours ('+grouped.window+'-'+(isDaily?'day':'week')+' avg)</span>':'');
 const displayed=rows.reduce((sum,row)=>sum+row.total,0);
 return '<div class="gp-analytics-graph-scroll" tabindex="0" aria-label="Scrollable hours graph">'+
  '<svg class="gp-weekly-chart" viewBox="0 0 '+width+' '+height+'" width="'+width+'" height="'+height+'" role="img" aria-label="Vertical grouped bars of hours by '+(gpAnalyticsSettings.group==='tag'?'tag':'member')+' each '+(isDaily?'day':'week')+'"><title>Logged hours</title>'+
  grid+bars+average+labels+'</svg></div><div class="gp-analytics-legend">'+legend+'</div>'+
  '<p class="gp-analytics-chart-caption">'+formatHours(displayed)+' logged across displayed '+(isDaily?'days':'weeks')+
  (gpAnalyticsSettings.group==='tag'?' · Each log counts toward the task’s first tag only, so tagged hours are never counted twice.':' · Hours are credited to whoever logged them.')+
  (gpAnalyticsSettings.velocity?' The line shows the trailing '+grouped.window+'-'+(isDaily?'day':'week')+' average of total team hours.':'')+'</p>';
}
function gpAnalyticsFeatureList(scope){
 if(!scope.features.length)return '<div class="gp-analytics-no-features">No features match this milestone.</div>';
 const ids=new Set(scope.features.map(f=>String(f.milestone_id)));
 let ordered=projectMilestonesNewestFirst().filter(m=>ids.has(String(m.milestone_id)));
 if(gpAnalyticsSettings.featureSort==='oldest')ordered.reverse();
 const groups=ordered.map(m=>{
  const features=scope.features.filter(f=>String(f.milestone_id)===String(m.milestone_id));
  const body=features.map(f=>{
   const tasks=scope.tasks.filter(t=>String(t.feature_id)===String(f.feature_id));
   const estimated=tasks.reduce((sum,t)=>sum+Math.max(0,Number(t.estimated_hours)||0),0);
   const logged=tasks.reduce((sum,t)=>sum+taskHours(t),0);
   const remaining=tasks.reduce((sum,t)=>sum+taskRemainingHours(t),0);
   return '<tr><th scope="row">'+e(f.name)+'<span class="gp-feature-tasks-count">'+tasks.filter(t=>t.status==='Done').length+'/'+tasks.length+' tasks done</span></th>'+
    '<td>'+formatHours(logged)+'</td><td>'+formatHours(estimated)+'</td><td>'+formatHours(remaining)+'</td></tr>';
  }).join('');
  return '<section class="gp-feature-time-group"><h3>'+e(m.name)+'</h3><div class="gp-feature-time-scroll"><table><thead><tr><th scope="col">Feature</th><th scope="col">Logged</th><th scope="col">Estimated</th><th scope="col">Remaining</th></tr></thead><tbody>'+body+'</tbody></table></div></section>';
 }).join('');
 return groups;
}
function gpAnalytics(){
 if(gpAnalyticsSettings.project!==String(activeProject))Object.assign(gpAnalyticsSettings,{project:String(activeProject),milestone:'all',interval:'week',range:'8',group:'person',velocity:true,featureSort:'newest'});
 const milestones=projectMilestonesNewestFirst();
 if(gpAnalyticsSettings.milestone!=='all'&&!milestones.some(m=>String(m.milestone_id)===gpAnalyticsSettings.milestone))gpAnalyticsSettings.milestone='all';
 const settings=gpAnalyticsSettings,scope=gpAnalyticsScope(),grouped=gpAnalyticsGroupedData(scope);
 const options='<option value="all"'+(settings.milestone==='all'?' selected':'')+'>All milestones</option>'+
  milestones.map(m=>'<option value="'+e(m.milestone_id)+'"'+(settings.milestone===String(m.milestone_id)?' selected':'')+'>'+e(m.name)+'</option>').join('');
 const choices=(entries,current)=>entries.map(([id,name])=>'<option value="'+id+'"'+(String(id)===String(current)?' selected':'')+'>'+name+'</option>').join('');
 const daily=settings.interval==='day';
 const ranges=daily?[['7','Last 7 days'],['14','Last 14 days'],['30','Last 30 days'],['all','All logged days']]:
  [['4','Last 4 weeks'],['8','Last 8 weeks'],['12','Last 12 weeks'],['all','All logged weeks']];
 const chart=gpAnalyticsChart(scope,grouped);
 const controls='<section class="gp-analytics-settings"><div class="gp-analytics-settings-title"><h2>Chart settings</h2><span>Choose what the bars represent</span></div><div class="gp-analytics-settings-fields">'+
  '<label>Milestone<select id="gpAnalyticsMilestone">'+options+'</select></label>'+
  '<label>Interval<select id="gpAnalyticsInterval">'+choices([['day','Daily'],['week','Weekly']],settings.interval)+'</select></label>'+
  '<label>Bars show<select id="gpAnalyticsGroup">'+choices([['person','Team members'],['tag','Task tags']],settings.group)+'</select></label>'+
  '<label>Time range<select id="gpAnalyticsRange">'+choices(ranges,settings.range)+'</select></label>'+
  '<label class="gp-analytics-velocity-toggle"><input type="checkbox" id="gpAnalyticsVelocity"'+(settings.velocity?' checked':'')+'> Show average velocity</label></div></section>';
 const featureSort='<label class="gp-feature-sort">Sort milestones<select id="gpFeatureSort">'+choices([['newest','Newest first'],['oldest','Oldest first']],settings.featureSort)+'</select></label>';
 const footer='<section class="gp-analytics-feature-section"><div class="gp-analytics-feature-heading"><div><h2>Feature time</h2><p>Logged, estimated, and remaining time, organized by milestone.</p></div>'+featureSort+'</div>'+gpAnalyticsFeatureList(scope)+'</section>';
 const undatedHours=scope.undated.reduce((sum,row)=>sum+row.hours,0);
 const undatedNote=scope.undated.length?'<p class="gp-analytics-undated">'+scope.undated.length+' undated entries ('+formatHours(undatedHours)+') omitted from the timeline but included in feature totals.</p>':'';
 $('#gpExtra').innerHTML='<section class="gp-analytics-main-chart"><div class="gp-analytics-heading"><div><h2>'+ (daily?'Daily':'Weekly')+' work</h2><p>Logged hours by '+(settings.group==='tag'?'task tag':'team member')+'</p></div></div>'+chart+undatedNote+'</section>'+controls+footer;
 $('#gpAnalyticsMilestone').onchange=ev=>{settings.milestone=ev.target.value;gpAnalytics()};
 $('#gpAnalyticsInterval').onchange=ev=>{settings.interval=ev.target.value;settings.range=settings.interval==='day'?'14':'8';gpAnalytics()};
 $('#gpAnalyticsGroup').onchange=ev=>{settings.group=ev.target.value;gpAnalytics()};
 $('#gpAnalyticsRange').onchange=ev=>{settings.range=ev.target.value;gpAnalytics()};
 $('#gpAnalyticsVelocity').onchange=ev=>{settings.velocity=ev.target.checked;gpAnalytics()};
 $('#gpFeatureSort').onchange=ev=>{settings.featureSort=ev.target.value;gpAnalytics()};
}
gpAddShell();
gpSetupHierarchyAnimation();
gpSetupHistoryControls();
render();
