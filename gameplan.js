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
function gpPrompt(message,initialValue=''){return gpDialog(message,{title:message.split('\\n')[0].replace(/:$/,''),confirmLabel:'Continue',input:true,initialValue})}

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
 let html=gpOriginalRow(t),extra=gpTagBadges(t);
 if(extra)html=html.replace('</button><div class="sub">','</button><div class="gp-badges">'+extra+'</div><div class="sub">');
 if(gpSelecting)html=html.replace('<div class="task-entry ', '<div class="task-entry gp-selectable ').replace('"><div><button class="task-title','"><label class="gp-task-select"><input type="checkbox" data-gp-select="'+e(t.task_id)+'" '+(gpSelected.has(String(t.task_id))?'checked':'')+' aria-label="Select task"></label><div><button class="task-title');
 return html;
};
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
};
function gpNavigate(page){gpPage=page;gpSelected.clear();gpSelecting=false;$('#sidebar').classList.remove('visible');render()}
function gpAddShell(){
 const sidebar=$('#sidebar');
 sidebar.querySelector('.sidebar-brand').innerHTML='<span class="gp-long">✳ Game<span>Plan</span></span><span class="gp-short">✳</span>';
 const nav=document.createElement('nav');nav.id='gpPrimary';nav.className='side-nav';
 nav.innerHTML=[['board','▦','Board'],['analytics','▥','Analytics'],['templates','▤','Templates'],['settings','⚙','Project Settings']].map(([v,icon,label])=>'<button class="gp-nav" data-page="'+v+'" title="'+label+'"><span class="gp-icon">'+icon+'</span><span class="gp-text">'+label+'</span></button>').join('');
 const sidebarToggle=document.createElement('button');
 sidebarToggle.id='gpSidebarToggle';sidebarToggle.type='button';sidebarToggle.className='gp-sidebar-toggle';
 sidebarToggle.innerHTML='<span aria-hidden="true">☰</span><span class="gp-toggle-text">Collapse sidebar</span>';
 sidebarToggle.setAttribute('aria-label','Collapse sidebar');
 sidebar.querySelector('.sidebar-brand').after(sidebarToggle,nav);
 const boardNav=document.createElement('div');boardNav.id='gpBoardNav';
 const label=sidebar.querySelector('.side-label');const milestone=sidebar.querySelector('#milestoneNav');
 label.before(boardNav);boardNav.append(label,sidebar.querySelector('#viewNav'),milestone.previousElementSibling,milestone);
 nav.insertBefore(boardNav,nav.children[1]);
 const main=$('#mainApp');const board=document.createElement('div');board.id='gpBoardView';while(main.firstChild)board.append(main.firstChild);main.append(board);
 const extra=document.createElement('section');extra.id='gpExtra';extra.className='card';main.append(extra);
 const selectButton=document.createElement('button');selectButton.id='gpSelectTasks';selectButton.className='button';selectButton.textContent='☑ Select tasks';$('#pmActions').before(selectButton);
 const bar=document.createElement('div');bar.id='gpSelectionBar';bar.hidden=true;$('#milestoneList').before(bar);
 $('#gpPrimary').onclick=ev=>{const b=ev.target.closest('[data-page]');if(b)gpNavigate(b.dataset.page)};
 $('#gpSelectTasks').onclick=()=>{gpSelecting=!gpSelecting;gpSelected.clear();renderMilestones();gpSelectionBar()};
 $('#milestoneList').addEventListener('change',ev=>{const el=ev.target.closest('[data-gp-select]');if(!el)return;el.checked?gpSelected.add(el.dataset.gpSelect):gpSelected.delete(el.dataset.gpSelect);gpSelectionBar()});
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
 $('#gpSelectTasks').textContent=gpSelecting?'✕ Stop selecting':'☑ Select tasks';
 if(!gpSelecting)return;
 bar.innerHTML='<div class="gp-flex">'+gpSelected.size+' tasks selected <button class="button main" id="gpSaveSelection" '+(gpSelected.size?'':'disabled')+'>Save as Template</button></div>';
 $('#gpSaveSelection').onclick=gpSaveTemplate;
}
function gpRenderPage(){
 $('#gpBoardView').hidden=gpPage!=='board';
 $('#gpExtra').hidden=gpPage==='board';
 $('#gpBoardNav').hidden=gpPage!=='board';
 document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===gpPage));
 gpSelectionBar();
 if(gpPage==='settings')gpSettings();
 if(gpPage==='analytics')gpAnalytics();
 if(gpPage==='templates')gpTemplatesPage();
}
function gpSettings(){
 const project=find(data.projects,activeProject,'project_id');
 $('#gpExtra').innerHTML='<div class="gp-flex"><div><h1>Project Settings</h1><p class="sub">'+e(project.project_name)+'</p></div><button class="button" id="gpRename">Edit project name</button></div><h2>Project tags</h2><p class="sub">Tags can be assigned to multiple tasks. For analytics, the first tag receives the logged time so hours are not counted twice.</p><div class="gp-list" id="gpTags">'+gpTags().map(t=>'<div class="gp-card gp-flex"><span class="gp-tag" style="--tc:'+e(t.color)+'">'+e(t.name)+'</span><div class="actions"><button class="button" data-tag-edit="'+e(t.tag_id)+'">Edit</button><button class="button danger" data-tag-delete="'+e(t.tag_id)+'">Delete</button></div></div>').join('')+'</div><p><button class="button main" id="gpAddTag">+ Add tag</button></p>';
 $('#gpRename').onclick=async()=>{const name=await gpPrompt('Project name',project.project_name);if(name?.trim()){project.project_name=name.trim();persist();render()}};
 $('#gpAddTag').onclick=()=>gpEditTag();
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
gpAddShell();gpRenderPage();
