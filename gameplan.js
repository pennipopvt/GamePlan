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
let gpPage='board',gpSelecting=false,gpBoardSubtabsOpen=true;
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
 let html=gpOriginalRow(t),extra=gpTagBadges(t);
 if(extra)html=html.replace('</button><div class="sub">','</button><div class="gp-badges">'+extra+'</div><div class="sub">');
 if(gpSelecting)html=html.replace(/(<div class="task-entry [^"]*)(")/,(_match,classes,quote)=>classes+' gp-template-selectable'+(gpSelected.has(String(t.task_id))?' gp-template-selected':'')+quote+' data-gp-template-task="'+e(t.task_id)+'" aria-selected="'+String(gpSelected.has(String(t.task_id)))+'"');
 return html;
};
/* Drag-and-drop task reassignment: only the feature ID changes, preserving logs and metadata. */
const gpDragTaskRow=taskRow;
taskRow=function(task){
 let html=gpDragTaskRow(task);
 if(!isPM())return html;
 const handle='<span class="gp-task-drag-handle" draggable="true" data-gp-drag-task="'+e(task.task_id)+'" title="Drag to another feature" aria-label="Drag '+e(task.title)+' to another feature" role="img"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="currentColor"><circle cx="8" cy="5" r="1.7"/><circle cx="16" cy="5" r="1.7"/><circle cx="8" cy="12" r="1.7"/><circle cx="16" cy="12" r="1.7"/><circle cx="8" cy="19" r="1.7"/><circle cx="16" cy="19" r="1.7"/></svg></span>';
 return html.replace(/(<div class="task-entry [^"]*">)/, '$1'+handle);
};
const gpOriginalRenderMilestones=renderMilestones;
renderMilestones=function(){gpOriginalRenderMilestones();gpWireTaskDrag()};
let gpDraggingTaskId=null;
function gpWireTaskDrag(){
 const root=$('#milestoneList');
 const clear=()=>{
  gpDraggingTaskId=null;
  root.querySelectorAll('.gp-task-dragging,.gp-feature-drop-target').forEach(el=>el.classList.remove('gp-task-dragging','gp-feature-drop-target'));
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
  const target=ev.target.closest?.('.feature-section[data-feat]');
  const task=data.tasks.find(t=>String(t.task_id)===gpDraggingTaskId);
  const feature=target&&data.features.find(f=>String(f.feature_id)===String(target.dataset.feat));
  root.querySelectorAll('.gp-feature-drop-target').forEach(el=>{if(el!==target)el.classList.remove('gp-feature-drop-target')});
  if(!task||!feature||task.project_id!==activeProject||feature.project_id!==activeProject||String(task.feature_id)===String(feature.feature_id))return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect='move';
  target.classList.add('gp-feature-drop-target');
 };
 root.ondragleave=ev=>{
  const feature=ev.target.closest?.('.feature-section[data-feat]');
  if(feature&&!feature.contains(ev.relatedTarget))feature.classList.remove('gp-feature-drop-target');
 };
 root.ondrop=ev=>{
  const target=ev.target.closest?.('.feature-section[data-feat]');
  const task=data.tasks.find(t=>String(t.task_id)===gpDraggingTaskId);
  const feature=target&&data.features.find(f=>String(f.feature_id)===String(target.dataset.feat));
  if(!task||!feature||!isPM()||task.project_id!==activeProject||feature.project_id!==activeProject||String(task.feature_id)===String(feature.feature_id)){clear();return}
  ev.preventDefault();ev.stopPropagation();
  const oldFeatureId=task.feature_id;
  task.feature_id=feature.feature_id;
  task.updated_at=new Date().toISOString();
  try{persist();render()}catch(err){task.feature_id=oldFeatureId;gpAlert('Could not move task: '+err.message);render()}
  clear();
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
 if(page==='board'&&gpPage==='board'&&!document.querySelector('.app').classList.contains('gp-collapsed')){
  gpBoardSubtabsOpen=!gpBoardSubtabsOpen;
  gpRenderPage();
  return;
 }
 if(page==='board'&&gpPage!=='board')gpBoardSubtabsOpen=true;
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

 const boardNav=document.createElement('div');boardNav.id='gpBoardNav';
 const label=sidebar.querySelector('.side-label');const milestone=sidebar.querySelector('#milestoneNav');
 label.before(boardNav);boardNav.append(label,sidebar.querySelector('#viewNav'),milestone.previousElementSibling,milestone);
 nav.insertBefore(boardNav,nav.children[1]);
 const main=$('#mainApp');const board=document.createElement('div');board.id='gpBoardView';while(main.firstChild)board.append(main.firstChild);main.append(board);
 const extra=document.createElement('section');extra.id='gpExtra';extra.className='card';main.append(extra);
 const headerActions=document.createElement('div');headerActions.className='gp-header-actions';
 headerActions.setAttribute('aria-label','Import and export');
 for(const id of ['export','import','importMilestone','fileInput','milestoneFileInput']){
  const control=document.getElementById(id);
  if(control)headerActions.appendChild(control);
 }
 header.appendChild(headerActions);
 const boardFooter=document.createElement('section');boardFooter.className='gp-board-footer';
 boardFooter.innerHTML='<h2>Board Tools</h2><p>Undo changes, reload, or open the online board.</p>';
 boardFooter.appendChild($('.top-actions'));
 board.append(boardFooter);
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
 const boardSubtabs=$('#gpBoardNav');
 boardSubtabs.hidden=gpPage!=='board';
 if(gpPage==='board'){
  if(boardSubtabs.scrollHeight>0)boardSubtabs.style.setProperty('--gp-board-nav-height',boardSubtabs.scrollHeight+'px');
  boardSubtabs.classList.toggle('gp-subtabs-closed',!gpBoardSubtabsOpen);
 }
 const boardTab=$('#gpPrimary [data-page="board"]');
 if(boardTab)boardTab.setAttribute('aria-expanded',String(gpPage==='board'&&gpBoardSubtabsOpen));
 document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===gpPage));
 gpSelectionBar();
 if(gpPage==='settings')gpSettings();
 if(gpPage==='analytics')gpAnalytics();
 if(gpPage==='templates')gpTemplatesPage();
 if(gpPage==='team')gpTeamPage();
}
function gpSettings(){
 const project=find(data.projects,activeProject,'project_id');
 $('#gpExtra').innerHTML='<div class="gp-flex"><div><h1>Project Settings</h1><p class="sub">'+e(project.project_name)+'</p></div><button class="button" id="gpRename">Edit project name</button></div><h2>Project Tags</h2><p class="sub">Tags can be assigned to multiple tasks. For analytics, the first tag receives the logged time so hours are not counted twice.</p><div class="gp-list" id="gpTags">'+gpTags().map(t=>'<div class="gp-card gp-flex"><span class="gp-tag" style="--tc:'+e(t.color)+'">'+e(t.name)+'</span><div class="actions"><button class="button" data-tag-edit="'+e(t.tag_id)+'">Edit</button><button class="button danger" data-tag-delete="'+e(t.tag_id)+'">Delete</button></div></div>').join('')+'</div><p><button class="button main" id="gpAddTag">+ Add tag</button></p><section class="gp-danger-zone"><h2>Danger Zone</h2><p class="sub">Permanently delete this project, including its milestones, features, tasks, time logs, tags, templates and team memberships. Other projects will stay intact.</p><button type="button" class="button danger" id="gpDeleteProject">Delete project</button></section>';
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
function gpEditTag(id=''){
 const tag=gpTags().find(t=>t.tag_id===id),defaults=GP_COLORS.map(c=>c.hex);
 const saved=(data.custom_tag_colors||[]).filter(c=>c.project_id===activeProject).map(c=>c.color);
 const palette=[...new Set([...defaults,...saved,...(tag?.color?[tag.color]:[])])];
 const selected=tag?.color||palette[0];
 const colorTile=color=>'<label class="gp-color-tile" data-gp-color="'+e(color)+'" title="'+(defaults.includes(color)?'Default color':'Right-click to delete custom color')+'" aria-label="Select '+e(color)+'"><input type="radio" name="color" value="'+e(color)+'" '+(selected===color?'checked':'')+'><span class="gp-color-fill" style="background:'+e(color)+'"></span></label>';
 const pickerHTML='<div id="gpInlinePicker" class="gp-inline-picker" hidden><div class="gp-picker-sv" id="gpPickerSV" role="slider" aria-label="Saturation and brightness" tabindex="0"><div class="gp-picker-sv-cursor" id="gpPickerCursor"></div></div><div class="gp-picker-hue-row"><div class="gp-hue-track"><input type="range" id="gpPickerHue" min="0" max="360" value="0" aria-label="Hue"></div><span id="gpPickerSwatch" class="gp-picker-swatch"></span></div><div class="gp-picker-actions"><button type="button" class="button" id="gpPickerCancel">Cancel</button><button type="button" class="button main" id="gpPickerConfirm">Add Color</button></div></div>';
 modal(tag?'Edit tag':'Add tag','<form id="actionForm"><div class="fields">'+field('name','Tag name',tag?.name||'','text',true)+'<div class="wide"><strong>Tag color</strong><div class="gp-color-grid" id="gpColorGrid">'+palette.map(colorTile).join('')+'<button type="button" class="gp-color-add" id="gpOpenPicker" title="Add custom color" aria-label="Add custom color">+</button></div><div class="gp-palette-tools"><button type="button" class="button" id="gpClearColors">Clear custom colors</button><span class="sub">Right-click a custom square to delete it.</span></div><div class="gp-color-context" id="gpColorContext" hidden><button type="button" id="gpDeleteColor">Delete color</button></div>'+pickerHTML+'<div class="gp-color-preview"><span class="sub">Preview</span> <span id="gpPreviewTag" class="gp-tag"></span></div></div></div><div class="controls"><button type="button" class="button" id="gpCancel">Cancel</button><button type="submit" class="button main">Save tag</button></div></form>');
 $('#gpCancel').onclick=closeModal;
 const form=$('#actionForm'),grid=$('#gpColorGrid'),panel=$('#gpInlinePicker'),sv=$('#gpPickerSV'),hue=$('#gpPickerHue'),context=$('#gpColorContext');
 let draft=gpColorToHSV(selected),contextColor=null;
 const preview=()=>{const color=form.querySelector('[name=color]:checked')?.value||selected;$('#gpPreviewTag').style.setProperty('--tc',color);$('#gpPreviewTag').textContent=form.querySelector('[name=name]').value.trim()||'New tag'};
 const removeCustomColor=color=>{
  data.custom_tag_colors=(data.custom_tag_colors||[]).filter(c=>!(c.project_id===activeProject&&c.color===color));
  const tile=[...grid.querySelectorAll('[data-gp-color]')].find(el=>el.dataset.gpColor===color);
  if(tile){
   const wasSelected=tile.querySelector('input').checked;
   tile.remove();
   if(wasSelected){const fallback=grid.querySelector('[name=color]');if(fallback)fallback.checked=true}
  }
  context.hidden=true;contextColor=null;persist();preview();
 };
 const closeContext=()=>{context.hidden=true;contextColor=null};
 grid.addEventListener('contextmenu',ev=>{
  const tile=ev.target.closest('[data-gp-color]');if(!tile)return;
  const color=tile.dataset.gpColor;
  if(defaults.includes(color))return;
  ev.preventDefault();
  contextColor=color;context.hidden=false;
  const container=form.getBoundingClientRect();
  context.style.left=Math.max(0,Math.min(ev.clientX-container.left,container.width-145))+'px';
  context.style.top=Math.max(0,ev.clientY-container.top+8)+'px';
 });
 $('#gpDeleteColor').onclick=()=>{if(contextColor)removeCustomColor(contextColor)};
 form.addEventListener('click',ev=>{if(!ev.target.closest('#gpColorContext')&&!ev.target.closest('[data-gp-color]'))closeContext()});
 $('#gpClearColors').onclick=async()=>{
  const custom=[...grid.querySelectorAll('[data-gp-color]')].filter(tile=>!defaults.includes(tile.dataset.gpColor));
  if(!custom.length){gpAlert('There are no custom colors to clear.');return}
  if(!await gpConfirm('Clear all custom colors from this project’s palette? Existing tags will keep their colors.',{danger:true,confirmLabel:'Clear colors'}))return;
  data.custom_tag_colors=(data.custom_tag_colors||[]).filter(c=>c.project_id!==activeProject);
  const checked=form.querySelector('[name=color]:checked')?.value;
  custom.forEach(tile=>tile.remove());
  if(checked&&!defaults.includes(checked)){const fallback=grid.querySelector('[name=color]');if(fallback)fallback.checked=true}
  closeContext();persist();preview();
 };
 const redraw=()=>{
  sv.style.backgroundColor=gpHSVToColor(draft.h,1,1);
  $('#gpPickerCursor').style.left=(draft.s*100)+'%';$('#gpPickerCursor').style.top=((1-draft.v)*100)+'%';
  $('#gpPickerSwatch').style.backgroundColor=gpHSVToColor(draft.h,draft.s,draft.v);
 };
 $('#gpOpenPicker').onclick=()=>{draft=gpColorToHSV(form.querySelector('[name=color]:checked')?.value||selected);hue.value=String(Math.round(draft.h));redraw();panel.hidden=false};
 $('#gpPickerCancel').onclick=()=>{panel.hidden=true};
 hue.oninput=()=>{draft.h=Number(hue.value);redraw()};
 const updateSV=ev=>{const bounds=sv.getBoundingClientRect();draft.s=Math.max(0,Math.min(1,(ev.clientX-bounds.left)/bounds.width));draft.v=1-Math.max(0,Math.min(1,(ev.clientY-bounds.top)/bounds.height));redraw()};
 sv.addEventListener('pointerdown',ev=>{sv.setPointerCapture(ev.pointerId);updateSV(ev)});
 sv.addEventListener('pointermove',ev=>{if(ev.buttons===1&&sv.hasPointerCapture(ev.pointerId))updateSV(ev)});
 sv.addEventListener('keydown',ev=>{const step=ev.shiftKey?.1:.025;if(ev.key==='ArrowLeft')draft.s=Math.max(0,draft.s-step);else if(ev.key==='ArrowRight')draft.s=Math.min(1,draft.s+step);else if(ev.key==='ArrowUp')draft.v=Math.min(1,draft.v+step);else if(ev.key==='ArrowDown')draft.v=Math.max(0,draft.v-step);else return;ev.preventDefault();redraw()});
 $('#gpPickerConfirm').onclick=()=>{
  const color=gpHSVToColor(draft.h,draft.s,draft.v);
  let radio=[...grid.querySelectorAll('[name=color]')].find(r=>r.value.toLowerCase()===color);
  if(!radio){$('#gpOpenPicker').insertAdjacentHTML('beforebegin',colorTile(color));radio=[...grid.querySelectorAll('[name=color]')].find(r=>r.value===color)}
  radio.checked=true;
  if(!data.custom_tag_colors)data.custom_tag_colors=[];
  if(!defaults.includes(color)&&!data.custom_tag_colors.some(c=>c.project_id===activeProject&&c.color===color)){data.custom_tag_colors.push({project_id:activeProject,color});persist()}
  panel.hidden=true;preview();
 };
 form.addEventListener('input',preview);form.addEventListener('change',preview);preview();
 form.onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.currentTarget),name=String(fd.get('name')||'').trim();if(!name)return;if(gpTags().some(t=>t.name.toLowerCase()===name.toLowerCase()&&t!==tag)){gpAlert('Tag name already exists');return}if(tag){tag.name=name;tag.color=fd.get('color')}else data.tags.push({tag_id:uid(),project_id:activeProject,name,color:fd.get('color')});persist();closeModal();render()};
}
async function gpDeleteTag(id){
 const tag=gpTags().find(t=>t.tag_id===id);if(!tag||!await gpConfirm('Delete '+tag.name+'? Tasks and templates will retain all other data.',{danger:true,confirmLabel:'Delete tag'}))return;
 data.tags=data.tags.filter(t=>t!==tag);
 data.tasks.forEach(t=>t.tag_ids=(t.tag_ids||[]).filter(x=>x!==id));
 data.templates.forEach(t=>t.tasks.forEach(item=>item.tag_ids=(item.tag_ids||[]).filter(x=>x!==id)));
 persist();render();
}
function gpAnalytics(){
 const tasks=projectTasks(),lookup=new Map(tasks.map(t=>[String(t.task_id),t])),groups=new Map();let total=0;
 for(const log of data.logs){const t=lookup.get(String(log.task_id));if(!t)continue;const tag=gpTags().find(g=>g.tag_id===(t.tag_ids||[])[0]);const key=String(log.member_id)+'|'+(tag?.name||'Untagged');groups.set(key,(groups.get(key)||0)+Number(log.hours||0));total+=Number(log.hours||0)}
 const rows=[...groups].map(([key,h])=>({name:member(key.split('|')[0]),tag:key.split('|').slice(1).join('|'),hours:h})).sort((a,b)=>b.hours-a.hours);
 $('#gpExtra').innerHTML='<h1>Analytics</h1><p class="sub">Actual logged time by person and primary task tag.</p><h2>'+formatHours(total)+' total</h2><div class="table-wrap"><table><thead><tr><th>Team member</th><th>Tag</th><th>Logged time</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+e(r.name)+'</td><td>'+e(r.tag)+'</td><td>'+formatHours(r.hours)+'</td></tr>').join('')+'</tbody></table></div>';
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
 $('#gpExtra').innerHTML='<div class="gp-flex"><div><h1>Feature Templates</h1><p class="sub">Select tasks across features to save a reusable collection.</p></div><button class="button main" id="gpChoose">+ Select tasks</button></div><div class="gp-list" id="gpTemplateList">'+gpTemplates().map(t=>'<div class="gp-card gp-flex"><div><h3>'+e(t.name)+'</h3><p class="sub">'+t.tasks.length+' tasks · '+formatHours(t.tasks.reduce((s,x)=>s+Number(x.estimated_hours||0),0))+' estimated</p></div><div class="actions"><button class="button" data-t-edit="'+e(t.template_id)+'">Edit</button><button class="button danger" data-t-delete="'+e(t.template_id)+'">Delete</button><button class="button main" data-t-use="'+e(t.template_id)+'">Use template</button></div></div>').join('')+'</div>';
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
    data.features.push({feature_id:fid,project_id:activeProject,milestone_id:mid,name,description:'',status:'To do'});
    for(const original of template.tasks){
     const h=Number(original.estimated_hours)||0;
     data.tasks.push({task_id:uid(),project_id:activeProject,feature_id:fid,title:original.title,description:original.description||'',tag_ids:[...(original.tag_ids||[])],priority:original.priority||'Normal',assignee_member_id:'',status:'To do',estimated_hours:h,remaining_hours:h,created_by_member_id:'penni',updated_at:''});
    }
    persist();
   }
   closeModal();activeView='m:'+mid;gpNavigate('board');
  }catch(err){gpAlert('Could not create feature: '+err.message);button.disabled=false}
 };
}
function gpUseTemplate(id){gpFeatureCreate('',id)}

async function gpDeleteProject(){
 const p=find(data.projects,activeProject,'project_id');if(!p)return;
 if(data.projects.length<=1){gpAlert('Create another project before deleting your last project.');return}
 const id=p.project_id;
 const ms=data.milestones.filter(x=>x.project_id===id),fs=data.features.filter(x=>x.project_id===id),tasks=data.tasks.filter(x=>x.project_id===id);
 const taskIds=new Set(tasks.map(x=>String(x.task_id)));
 const logs=data.logs.filter(x=>taskIds.has(String(x.task_id)));
 const summary='Delete project “'+p.project_name+'”?\\n\\nThis will permanently delete:\\n• '+ms.length+' milestones\\n• '+fs.length+' features\\n• '+tasks.length+' tasks\\n• '+logs.length+' time entries\\n• '+gpTags().length+' tags\\n• '+gpTemplates().length+' templates\\n\\nOther projects will not be changed. This cannot be undone.';
 if(!await gpConfirm(summary,{title:'Delete entire project?',danger:true,confirmLabel:'Continue'}))return;
 const typed=await gpPrompt('Type the project name to confirm deletion', '');
 if(typed!==p.project_name){if(typed!==null)gpAlert('Project name did not match. Nothing was deleted.');return}
 // Make one atomic local backup update; shared member identities remain available to other projects.
 const old=data;
 const next={...data,
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
 data=next;
 try{persist()}catch(err){data=old;gpAlert('Unable to save project deletion: '+err.message);return}
 activeProject=next.projects[0].project_id;activeView='all';gpSelected.clear();gpSelecting=false;
 $('#assigneeFilter').value='';$('#searchTasks').value='';
 saveProject();gpNavigate('board');
 gpAlert('Project deleted.');
}
function gpSwitchProject(id){
 if(!data.projects.some(p=>String(p.project_id)===String(id)))return;
 activeProject=id;activeView='all';gpSelected.clear();gpSelecting=false;saveProject();
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
 $('#gpExtra').innerHTML='<div class="gp-flex"><div><h1>Project Team</h1><p class="sub">Members of '+e(find(data.projects,activeProject,'project_id')?.project_name||'this project')+'</p></div><button id="gpAddMember" class="button main">+ Add member</button></div><div id="gpTeamRows" class="gp-list">'+memberships.map(m=>{
  const person=roster.find(p=>String(p.member_id)===String(m.member_id))||data.members.find(p=>String(p.member_id)===String(m.member_id));
  return '<div class="gp-card gp-flex"><div><strong>'+e(person?.display_name||'Unknown')+'</strong><div class="sub">'+e(m.project_role||'Member')+(m.discipline?' · '+e(m.discipline):'')+'</div></div><button type="button" class="button" data-gp-member="'+e(m.member_id)+'">Edit</button></div>';
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
 const area=document.querySelector('.gp-board-footer .top-actions');
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
gpAddShell();
gpSetupHierarchyAnimation();
gpSetupHistoryControls();
render();
