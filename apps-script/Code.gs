/**
 * Project Planner — Google Apps Script backend.
 * Deploy as: Web app, Execute as: Me, Who has access: Anyone.
 * The endpoint itself has no anonymous data operations: every call requires a
 * Google-signed ID token, verified against the configured OAuth client ID.
 * Do not put secrets or a Google service account credential in GitHub.
 */
const SPREADSHEET_ID = '1wDqr3NxhHD7VnvniFQHfJ6zhT9DHzB0y7wfTjVPZMGQ';
const SCHEMA = {
  Projects: ['project_id','project_name','description','status','created_at','project_manager_member_id'],
  Members: ['member_id','display_name','google_email','active'],
  'Project Team': ['project_id','member_id','project_role','discipline','membership_status'],
  Milestones: ['milestone_id','project_id','name','description','status','target_date'],
  Features: ['feature_id','project_id','milestone_id','name','description','status','estimated_hours'],
  Tasks: ['task_id','project_id','feature_id','title','description','assignee_member_id','status','priority','estimated_hours','remaining_hours','created_by_member_id','updated_at'],
  'Time Logs': ['log_id','task_id','member_id','work_date','hours','note','created_at']
};
const STATUSES = ['To do','In progress','Blocked','Done'];
const PRIORITIES = ['Low','Normal','High','Urgent'];
const ALLOWED_ORIGIN = 'https://pennipopvt.github.io';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Bridge')
    .setTitle('Project Planner shared-data bridge')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Only public server entry point. Server never trusts claimed roles, identities or assignees.
function dispatch(request) {
  if (!request || typeof request !== 'object' || typeof request.idToken !== 'string') throw Error('Sign in is required.');
  const email = verifyIdentity_(request.idToken);
  const op = String(request.op || '');
  const payload = request.payload && typeof request.payload === 'object' ? request.payload : {};
  if (op === 'load') return load_(email);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (op === 'createTask') return createTask_(email, payload);
    if (op === 'editTask') return editTask_(email, payload);
    if (op === 'setStatus') return setStatus_(email, payload);
    if (op === 'logHours') return logHours_(email, payload);
    if (op === 'createFeature') return createFeature_(email, payload);
    if (op === 'createMilestone') return createMilestone_(email, payload);
    if (op === 'editMilestone') return editMilestone_(email, payload);
    if (op === 'editFeature') return editFeature_(email, payload);
    if (op === 'addMember') return addMember_(email, payload);
    if (op === 'createProject') return createProject_(email, payload);
    throw Error('Unknown operation.');
  } finally { lock.releaseLock(); }
}

function verifyIdentity_(token) {
  const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) throw Error('The owner must configure GOOGLE_CLIENT_ID in Apps Script properties.');
  if (token.length > 5000) throw Error('Invalid sign-in token.');
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), {muteHttpExceptions:true});
  if (response.getResponseCode() !== 200) throw Error('Your Google session expired. Please sign in again.');
  const claims = JSON.parse(response.getContentText());
  if (claims.aud !== clientId || !['accounts.google.com','https://accounts.google.com'].includes(claims.iss) ||
      String(claims.email_verified) !== 'true' || Number(claims.exp) * 1000 < Date.now() || !claims.email) {
    throw Error('Google identity could not be verified.');
  }
  return String(claims.email).trim().toLowerCase();
}
function tab_(name) {
  const s = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
  if (!s) throw Error('Missing sheet: ' + name);
  const headers = s.getRange(1,1,1,SCHEMA[name].length).getDisplayValues()[0];
  if (headers.join('|') !== SCHEMA[name].join('|')) throw Error('Unexpected schema in ' + name);
  return s;
}
function rows_(name) {
  const sheet = tab_(name), headers = SCHEMA[name], last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2,1,last-1,headers.length).getValues().map((values,i)=>{
    const obj = {_row:i+2}; headers.forEach((h,j)=>obj[h]=values[j] instanceof Date ? Utilities.formatDate(values[j], 'GMT','yyyy-MM-dd') : values[j]); return obj;
  }).filter(row=>String(row[headers[0]]).trim());
}
function insert_(name,row) { const s = tab_(name); s.appendRow(SCHEMA[name].map(h=>row[h] == null ? '' : row[h])); return row; }
function patch_(name,row,changes,allowed) {
  const sheet=tab_(name); allowed.forEach(key=>{if(Object.prototype.hasOwnProperty.call(changes,key)){
    sheet.getRange(row._row,SCHEMA[name].indexOf(key)+1).setValue(changes[key]);
  }});
}
function required_(v,name,max=5000){const s=String(v??'').trim();if(!s||s.length>max)throw Error('Invalid '+name);return s;}
function optional_(v,max=5000){const s=String(v??'').trim();if(s.length>max)throw Error('Text is too long');return s;}
function hours_(v) {const n=Number(v);if(!Number.isFinite(n)||n<0||n>100000)throw Error('Invalid hours');return n;}
function uid_(){return Utilities.getUuid();}
function now_(){return new Date().toISOString();}
function identity_(email) {const member=rows_('Members').find(m=>String(m.google_email).trim().toLowerCase()===email && String(m.active).toLowerCase()==='yes');if(!member)throw Error('No account is associated with '+email+'. Ask a project manager to add your Google email.');return member;}
function membership_(memberId,projectId){return rows_('Project Team').find(m=>String(m.member_id)===String(memberId)&&String(m.project_id)===String(projectId)&&String(m.membership_status).toLowerCase()==='active');}
function permit_(email,projectId,pmOnly=false) {
  const member=identity_(email), team=membership_(member.member_id,projectId);
  if(!team)throw Error('You are not on this project team.');
  if(pmOnly&&team.project_role!=='PM')throw Error('Only the project manager can do that.');
  return {member,team};
}
function load_(email) {
  const me=identity_(email), memberships=rows_('Project Team').filter(x=>x.member_id===me.member_id && String(x.membership_status).toLowerCase()==='active');
  const ids=new Set(memberships.map(m=>String(m.project_id)));
  const projects=rows_('Projects').filter(p=>ids.has(String(p.project_id)));
  const teamMemberIds=new Set(rows_('Project Team').filter(x=>ids.has(String(x.project_id))&&String(x.membership_status).toLowerCase()==='active').map(x=>String(x.member_id)));
  const members=rows_('Members').filter(x=>teamMemberIds.has(String(x.member_id))).map(x=>({member_id:x.member_id,display_name:x.display_name}));
  const teamForProjects=rows_('Project Team').filter(x=>ids.has(String(x.project_id)));
  const allowedTeamIds=new Set(teamForProjects.map(x=>String(x.member_id)));
  const roster=rows_('Members').filter(x=>allowedTeamIds.has(String(x.member_id))).map(x=>({member_id:x.member_id,display_name:x.display_name,google_email: x.member_id===me.member_id||teamForProjects.some(t=>t.member_id===x.member_id&&t.project_role==='PM'&&memberships.some(my=>my.project_id===t.project_id&&my.project_role==='PM'))?x.google_email:'',active:x.active}));
  const tasks=rows_('Tasks').filter(x=>ids.has(String(x.project_id)));
  const taskIds=new Set(tasks.map(x=>String(x.task_id)));
  const logs=rows_('Time Logs').filter(x=>taskIds.has(String(x.task_id)));
  return {email,me:{member_id:me.member_id,display_name:me.display_name},memberships:memberships.map(({_row,...m})=>m),
    projects:projects.map(({_row,...x})=>x),members,roster:roster,team:teamForProjects.map(({_row,...x})=>x),
    milestones:rows_('Milestones').filter(x=>ids.has(String(x.project_id))).map(({_row,...x})=>x),
    features:rows_('Features').filter(x=>ids.has(String(x.project_id))).map(({_row,...x})=>x),
    tasks:tasks.map(({_row,...x})=>x),logs:logs.map(({_row,...x})=>x)};
}
function task_(id){const t=rows_('Tasks').find(x=>String(x.task_id)===String(id));if(!t)throw Error('Task not found');return t;}
function createTask_(email,p){const projectId=required_(p.project_id,'project');const {member}=permit_(email,projectId,true);
  const f=rows_('Features').find(x=>String(x.feature_id)===String(p.feature_id)&&String(x.project_id)===projectId);if(!f)throw Error('Select a feature in this project.');
  const assignee=required_(p.assignee_member_id,'assignee');if(!membership_(assignee,projectId))throw Error('Assignee must belong to this project.');
  const status=STATUSES.includes(p.status)?p.status:'To do';const priority=PRIORITIES.includes(p.priority)?p.priority:'Normal';
  insert_('Tasks',{task_id:uid_(),project_id:projectId,feature_id:f.feature_id,title:required_(p.title,'title',160),description:optional_(p.description),assignee_member_id:assignee,status,priority,estimated_hours:hours_(p.estimated_hours||0),remaining_hours:hours_(p.remaining_hours||0),created_by_member_id:member.member_id,updated_at:now_()});return {ok:true};}
function editTask_(email,p){const t=task_(required_(p.task_id,'task'));permit_(email,t.project_id,true);
 const f=rows_('Features').find(x=>String(x.feature_id)===String(p.feature_id)&&String(x.project_id)===String(t.project_id));if(!f)throw Error('Invalid parent feature');
 const assignee=required_(p.assignee_member_id,'assignee');if(!membership_(assignee,t.project_id))throw Error('Assignee must belong to this project');
 if(!STATUSES.includes(p.status)||!PRIORITIES.includes(p.priority))throw Error('Invalid status or priority');
 patch_('Tasks',t,{title:required_(p.title,'title',160),description:optional_(p.description),feature_id:f.feature_id,assignee_member_id:assignee,status:p.status,priority:p.priority,estimated_hours:hours_(p.estimated_hours),remaining_hours:hours_(p.remaining_hours),updated_at:now_()},['title','description','feature_id','assignee_member_id','status','priority','estimated_hours','remaining_hours','updated_at']);return {ok:true};}
function setStatus_(email,p){const t=task_(required_(p.task_id,'task'));const {member,team}=permit_(email,t.project_id);if(team.project_role!=='PM'&&String(t.assignee_member_id)!==String(member.member_id))throw Error('You can only update your own tasks');if(!STATUSES.includes(p.status))throw Error('Invalid status');patch_('Tasks',t,{status:p.status,updated_at:now_()},['status','updated_at']);return {ok:true};}
function logHours_(email,p){const t=task_(required_(p.task_id,'task'));const {member,team}=permit_(email,t.project_id);if(team.project_role!=='PM'&&String(t.assignee_member_id)!==String(member.member_id))throw Error('You can only log your own tasks');const hrs=hours_(p.hours);if(hrs<=0||hrs>24)throw Error('Work session must be between 0 and 24 hours');const date=required_(p.work_date,'date');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid date');insert_('Time Logs',{log_id:uid_(),task_id:t.task_id,member_id:member.member_id,work_date:date,hours:hrs,note:optional_(p.note,1200),created_at:now_()});return {ok:true};}
function createFeature_(email,p){const projectId=required_(p.project_id,'project');permit_(email,projectId,true);const ms=rows_('Milestones').find(x=>String(x.milestone_id)===String(p.milestone_id)&&String(x.project_id)===projectId);if(!ms)throw Error('Invalid milestone');insert_('Features',{feature_id:uid_(),project_id:projectId,milestone_id:ms.milestone_id,name:required_(p.name,'name',160),description:optional_(p.description),status:'To do',estimated_hours:0});return {ok:true};}
function createMilestone_(email,p){const projectId=required_(p.project_id,'project');permit_(email,projectId,true);insert_('Milestones',{milestone_id:uid_(),project_id:projectId,name:required_(p.name,'name',160),description:optional_(p.description),status:'To do',target_date:''});return {ok:true};}
function addMember_(email,p){const projectId=required_(p.project_id,'project');permit_(email,projectId,true);const userEmail=required_(p.google_email,'Google email',254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail))throw Error('Invalid email');let m=rows_('Members').find(x=>String(x.google_email).trim().toLowerCase()===userEmail);if(!m){const existing=rows_('Members').find(x=>!String(x.google_email).trim()&&String(x.display_name).trim().toLowerCase()===String(p.display_name).trim().toLowerCase());
    if(existing){patch_('Members',existing,{google_email:userEmail,active:'Yes'},['google_email','active']);m=existing;}
    else{m={member_id:uid_(),display_name:required_(p.display_name,'name',120),google_email:userEmail,active:'Yes'};insert_('Members',m);}}
  if(membership_(m.member_id,projectId))throw Error('Already a member');
  const pending=rows_('Project Team').find(x=>x.member_id===m.member_id&&x.project_id===projectId);
  if(pending){patch_('Project Team',pending,{membership_status:'Active',project_role:'Member',discipline:optional_(p.discipline,80)||pending.discipline},['membership_status','project_role','discipline']);return {ok:true};}
  insert_('Project Team',{project_id:projectId,member_id:m.member_id,project_role:'Member',discipline:optional_(p.discipline,80),membership_status:'Active'});return {ok:true};}
function createProject_(email,p){const me=identity_(email), isPM=rows_('Project Team').some(x=>x.member_id===me.member_id&&x.project_role==='PM'&&String(x.membership_status).toLowerCase()==='active');if(!isPM)throw Error('Only a PM can create projects');const id=uid_();insert_('Projects',{project_id:id,project_name:required_(p.name,'project name',160),description:optional_(p.description),status:'Active',created_at:new Date().toISOString().slice(0,10),project_manager_member_id:me.member_id});insert_('Project Team',{project_id:id,member_id:me.member_id,project_role:'PM',discipline:'',membership_status:'Active'});return {ok:true};}

function editMilestone_(email,p){
  const id=required_(p.milestone_id,'milestone');
  const m=rows_('Milestones').find(x=>String(x.milestone_id)===id);
  if(!m)throw Error('Milestone not found');
  permit_(email,m.project_id,true);
  if(!STATUSES.includes(p.status))throw Error('Invalid milestone status');
  const target=optional_(p.target_date,10);
  if(target&&!/^\d{4}-\d{2}-\d{2}$/.test(target))throw Error('Invalid target date');
  patch_('Milestones',m,{name:required_(p.name,'name',160),description:optional_(p.description),status:p.status,target_date:target},['name','description','status','target_date']);
  return {ok:true};
}
function editFeature_(email,p){
  const id=required_(p.feature_id,'feature');
  const f=rows_('Features').find(x=>String(x.feature_id)===id);
  if(!f)throw Error('Feature not found');
  permit_(email,f.project_id,true);
  const milestone=rows_('Milestones').find(x=>String(x.milestone_id)===String(p.milestone_id)&&String(x.project_id)===String(f.project_id));
  if(!milestone)throw Error('Invalid parent milestone');
  if(!STATUSES.includes(p.status))throw Error('Invalid feature status');
  patch_('Features',f,{name:required_(p.name,'name',160),description:optional_(p.description),status:p.status,milestone_id:milestone.milestone_id,estimated_hours:hours_(p.estimated_hours||0)},['name','description','status','milestone_id','estimated_hours']);
  return {ok:true};
}
