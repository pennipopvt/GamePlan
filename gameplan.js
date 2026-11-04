'use strict';
/* GamePlan extension: project tags, saved templates, analytics and navigation. */
const GP_COLORS=[{name:'Blue',hex:'#729fd6'},{name:'Pink',hex:'#db8bac'},{name:'Purple',hex:'#ac91d6'},{name:'Yellow',hex:'#d8b56b'},{name:'Green',hex:'#68a992'},{name:'Orange',hex:'#e18b71'},{name:'Gray',hex:'#98aab6'}];
let gpPage='board',gpSelecting=false;
const gpSelected=new Set();
const gpTags=()=>data.tags.filter(x=>x.project_id===activeProject);
const gpTemplates=()=>data.templates.filter(x=>x.project_id===activeProject);
const gpTagBadges=task=>(task.tag_ids||[]).map(id=>gpTags().find(t=>t.tag_id===id)).filter(Boolean).map(t=>'<span class="gp-tag" style="--tc:'+e(t.color)+'">'+e(t.name)+'</span>').join('');
const gpOriginalLoad=loadLocal;
loadLocal=function(){const result=gpOriginalLoad();result.tags=Array.isArray(result.tags)?result.tags:[];result.templates=Array.isArray(result.templates)?result.templates:[];return result};
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
 sidebar.querySelector('.sidebar-brand').after(nav);
 const boardNav=document.createElement('div');boardNav.id='gpBoardNav';
 const label=sidebar.querySelector('.side-label');const milestone=sidebar.querySelector('#milestoneNav');
 label.before(boardNav);boardNav.append(label,sidebar.querySelector('#viewNav'),milestone.previousElementSibling,milestone);
 const main=$('#mainApp');const board=document.createElement('div');board.id='gpBoardView';while(main.firstChild)board.append(main.firstChild);main.append(board);
 const extra=document.createElement('section');extra.id='gpExtra';extra.className='card';main.append(extra);
 const selectButton=document.createElement('button');selectButton.id='gpSelectTasks';selectButton.className='button';selectButton.textContent='☑ Select tasks';$('#pmActions').before(selectButton);
 const bar=document.createElement('div');bar.id='gpSelectionBar';bar.hidden=true;$('#milestoneList').before(bar);
 $('#gpPrimary').onclick=ev=>{const b=ev.target.closest('[data-page]');if(b)gpNavigate(b.dataset.page)};
 $('#gpSelectTasks').onclick=()=>{gpSelecting=!gpSelecting;gpSelected.clear();renderMilestones();gpSelectionBar()};
 $('#milestoneList').addEventListener('change',ev=>{const el=ev.target.closest('[data-gp-select]');if(!el)return;el.checked?gpSelected.add(el.dataset.gpSelect):gpSelected.delete(el.dataset.gpSelect);gpSelectionBar()});
 $('#menuToggle').onclick=()=>{
  if(innerWidth<=680){$('#sidebar').classList.toggle('visible');return}
  const collapsed=document.querySelector('.app').classList.toggle('gp-collapsed');
  try{localStorage.setItem('gp-collapsed',collapsed?'1':'0')}catch{}
 };
 try{if(localStorage.getItem('gp-collapsed')==='1')document.querySelector('.app').classList.add('gp-collapsed')}catch{}
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
 $('#gpRename').onclick=()=>{const name=prompt('Project name',project.project_name);if(name?.trim()){project.project_name=name.trim();persist();render()}};
 $('#gpAddTag').onclick=()=>gpEditTag();
 $('#gpTags').onclick=ev=>{const a=ev.target.closest('[data-tag-edit]'),b=ev.target.closest('[data-tag-delete]');if(a)gpEditTag(a.dataset.tagEdit);if(b)gpDeleteTag(b.dataset.tagDelete)};
}
function gpEditTag(id=''){
 const tag=gpTags().find(t=>t.tag_id===id);
 const selected=GP_COLORS.some(c=>c.hex===tag?.color)?tag.color:GP_COLORS[0].hex;
 const colorChoices=GP_COLORS.map(c=>'<label class="gp-color-option"><input type="radio" name="color" value="'+c.hex+'" '+(selected===c.hex?'checked':'')+'><span class="gp-color-swatch" style="background:'+c.hex+'"></span><span>'+c.name+'</span></label>').join('');
 modal(tag?'Edit tag':'Add tag','<form id="actionForm"><div class="fields">'+field('name','Tag name',tag?.name||'','text',true)+'<div class="wide"><strong>Tag color</strong><div class="gp-color-grid">'+colorChoices+'</div><div class="gp-color-preview"><span class="sub">Preview</span> <span id="gpPreviewTag" class="gp-tag"></span></div></div></div><div class="controls"><button type="button" class="button" id="gpCancel">Cancel</button><button type="submit" class="button main">Save tag</button></div></form>');
 $('#gpCancel').onclick=closeModal;
 const form=$('#actionForm');
 const preview=()=>{const color=form.querySelector('[name=color]:checked')?.value||selected;$('#gpPreviewTag').style.setProperty('--tc',color);$('#gpPreviewTag').textContent=form.querySelector('[name=name]').value.trim()||'New tag'};
 form.addEventListener('input',preview);form.addEventListener('change',preview);preview();
 form.onsubmit=ev=>{ev.preventDefault();const fd=new FormData(ev.currentTarget),name=String(fd.get('name')||'').trim();if(!name)return;if(gpTags().some(t=>t.name.toLowerCase()===name.toLowerCase()&&t!==tag)){alert('Tag name already exists');return}if(tag){tag.name=name;tag.color=fd.get('color')}else data.tags.push({tag_id:uid(),project_id:activeProject,name,color:fd.get('color')});persist();closeModal();render()};
}
function gpDeleteTag(id){
 const tag=gpTags().find(t=>t.tag_id===id);if(!tag||!confirm('Delete '+tag.name+'? Tasks and templates will retain all other data.'))return;
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
function gpSaveTemplate(){
 const selected=projectTasks().filter(t=>gpSelected.has(String(t.task_id)));if(!selected.length)return;
 const unfinished=selected.filter(t=>t.status!=='Done');
 if(unfinished.length&&!confirm(unfinished.length+' selected tasks are unfinished. Use their existing estimates instead of their logged time?'))return;
 const name=prompt('Template name');if(!name?.trim())return;
 const tasks=selected.map(t=>({title:t.title,description:t.description||'',priority:t.priority||'Normal',tag_ids:[...(t.tag_ids||[])],estimated_hours:t.status==='Done'?Math.ceil(Math.round(taskHours(t)*60)/10)*10/60:Number(t.estimated_hours||0)}));
 data.templates.push({template_id:uid(),project_id:activeProject,name:name.trim(),tasks});persist();gpNavigate('templates');
}
function gpTemplatesPage(){
 $('#gpExtra').innerHTML='<div class="gp-flex"><div><h1>Feature Templates</h1><p class="sub">Select tasks across features to save a reusable collection.</p></div><button class="button main" id="gpChoose">+ Select tasks</button></div><div class="gp-list" id="gpTemplateList">'+gpTemplates().map(t=>'<div class="gp-card gp-flex"><div><h3>'+e(t.name)+'</h3><p class="sub">'+t.tasks.length+' tasks · '+formatHours(t.tasks.reduce((s,x)=>s+Number(x.estimated_hours||0),0))+' estimated</p></div><div class="actions"><button class="button" data-t-edit="'+e(t.template_id)+'">Edit</button><button class="button danger" data-t-delete="'+e(t.template_id)+'">Delete</button><button class="button main" data-t-use="'+e(t.template_id)+'">Use template</button></div></div>').join('')+'</div>';
 $('#gpChoose').onclick=()=>{gpNavigate('board');gpSelecting=true;renderMilestones();gpSelectionBar()};
 $('#gpTemplateList').onclick=ev=>{const a=ev.target.closest('[data-t-edit]'),b=ev.target.closest('[data-t-delete]'),c=ev.target.closest('[data-t-use]');if(a)gpEditTemplate(a.dataset.tEdit);if(b){const t=gpTemplates().find(x=>x.template_id===b.dataset.tDelete);if(t&&confirm('Delete '+t.name+'?')){data.templates=data.templates.filter(x=>x!==t);persist();render()}}if(c)gpUseTemplate(c.dataset.tUse)};
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
 if(tasks.some(task=>!task.title)){alert('Task titles cannot be blank.');return}t.name=name;t.tasks=tasks;persist();closeModal();render()};
}
function gpUseTemplate(id){
 const t=gpTemplates().find(x=>x.template_id===id),ms=data.milestones.filter(m=>m.project_id===activeProject);if(!t)return;
 if(!ms.length){alert('Create a milestone first.');return}
 modal('Create feature from template','<form id="actionForm"><div class="fields">'+field('name','New feature name',t.name,'text',true)+select('milestone_id','Milestone',opts(ms,'milestone_id'),ms[0].milestone_id,true)+'</div><div class="controls"><button class="button" type="button" id="gpCancel">Cancel</button><button class="button main" type="submit">Create feature</button></div></form>');
 $('#gpCancel').onclick=closeModal;
 $('#actionForm').onsubmit=ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget),name=String(f.get('name')||'').trim(),milestoneId=String(f.get('milestone_id'));if(!name||!ms.some(m=>String(m.milestone_id)===milestoneId))return;const featureId=uid();data.features.push({feature_id:featureId,project_id:activeProject,milestone_id:milestoneId,name,description:'',status:'To do'});for(const original of t.tasks){const h=Number(original.estimated_hours)||0;data.tasks.push({task_id:uid(),project_id:activeProject,feature_id:featureId,title:original.title,description:original.description||'',tag_ids:[...(original.tag_ids||[])],priority:original.priority||'Normal',assignee_member_id:'',status:'To do',estimated_hours:h,remaining_hours:h,created_by_member_id:'penni',updated_at:''})}persist();closeModal();activeView='m:'+milestoneId;gpNavigate('board')};
}
gpAddShell();gpRenderPage();
