/* GamePlan Cloud adapter — optional, does not modify the local board.
   Pass the public Supabase project URL + publishable key to createGamePlanCloud().
   Never put a service_role or secret key in browser code. */
import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const ITEM_KINDS=['milestones','features','tasks','logs','tags','templates','team','custom_tag_colors'];
const ID_FIELD={milestones:'milestone_id',features:'feature_id',tasks:'task_id',logs:'log_id',tags:'tag_id',templates:'template_id',team:'member_id'};
function check(error){if(error)throw error}
function requireId(value,name){const id=String(value??'').trim();if(!id)throw Error(name+' is required');return id}

export function createGamePlanCloud({url,publishableKey}){
 if(!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(url||''))throw Error('Enter a valid Supabase project URL.');
 if(!publishableKey||!String(publishableKey).trim())throw Error('Supabase publishable key is missing.');
 const client=createClient(url,publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 const currentUser=async()=>{
  const {data,error}=await client.auth.getUser();check(error);
  if(!data.user)throw Error('Sign in to access shared projects.');
  return data.user;
 };
 return {
  client,
  async signInWithDiscord(){
   const {data,error}=await client.auth.signInWithOAuth({
    provider:'discord',
    options:{redirectTo:location.origin+'/ProjectPlanner/supabase/discord.html'}
   });
   check(error);return data;
  },
  async signOut(){const {error}=await client.auth.signOut();check(error)},
  async getSession(){const {data,error}=await client.auth.getSession();check(error);return data.session},
  onAuthChange(callback){return client.auth.onAuthStateChange((_event,session)=>callback(session)).data.subscription},
  async listProjects(){
   await currentUser();
   const {error:claimError}=await client.rpc('gp_claim_invites');check(claimError);
   const {data,error}=await client.from('gp_projects').select('id,name,owner_id,created_at,updated_at').order('created_at',{ascending:false});
   check(error);return data;
  },
  async createProject(name){
   const owner=await currentUser();
   const {data,error}=await client.from('gp_projects').insert({name:requireId(name,'Project name'),owner_id:owner.id}).select('id,name,owner_id').single();
   check(error);return data;
  },
  async renameProject(projectId,name){
   await currentUser();
   const {data,error}=await client.from('gp_projects').update({name:requireId(name,'Project name'),updated_at:new Date().toISOString()}).eq('id',projectId).select().single();
   check(error);return data;
  },
  async inviteByEmail(projectId,email,role='editor'){
   const user=await currentUser(),address=String(email||'').trim().toLowerCase();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))throw Error('Enter a valid email address.');
   if(!['editor','viewer'].includes(role))throw Error('Invalid role.');
   const {data,error}=await client.from('gp_invites').insert({
    project_id:projectId,email:address,role,invited_by:user.id
   }).select('id,email,role').single();
   check(error);return data;
  },
  // Link-only invites: the token is generated inside Postgres, hashed at rest,
  // and can be redeemed only after Discord authentication.
  async createLinkInvite(projectId,role='editor',expiresDays=7){
   await currentUser();
   if(!['editor','viewer'].includes(role))throw Error('Invalid invite role.');
   if(!Number.isInteger(expiresDays)||expiresDays<1||expiresDays>30)throw Error('Choose an expiry from 1 to 30 days.');
   const {data,error}=await client.rpc('gp_create_link_invite',{
    p_project:projectId,p_role:role,p_expires_days:expiresDays
   });
   check(error);
   const invite=Array.isArray(data)?data[0]:data;
   if(!invite?.invite_token)throw Error('Could not create invite link.');
   return invite;
  },
  async listLinkInvites(projectId){
   await currentUser();
   const {data,error}=await client.rpc('gp_list_link_invites',{p_project:projectId});
   check(error);return data||[];
  },
  async revokeLinkInvite(inviteId){
   await currentUser();
   const {data,error}=await client.rpc('gp_revoke_link_invite',{p_invite:inviteId});
   check(error);return data===true;
  },
  async acceptLinkInvite(token){
   await currentUser();
   if(!/^[a-f0-9]{64}$/.test(String(token||'')))throw Error('Invalid invitation URL.');
   const {data,error}=await client.rpc('gp_accept_link_invite',{p_token:token});
   check(error);
   if(!data)throw Error('Could not join this project.');
   return data;
  },
  async listMembers(projectId){
   await currentUser();
   const {data,error}=await client.from('gp_members').select('project_id,user_id,role,joined_at').eq('project_id',projectId);
   check(error);return data;
  },
  async loadProjectItems(projectId){
   await currentUser();
   const {data,error}=await client.from('gp_items').select('kind,item_id,payload,sort_order,updated_at,updated_by').eq('project_id',projectId).order('sort_order');
   check(error);
   const result=Object.fromEntries(ITEM_KINDS.map(kind=>[kind,[]]));
   for(const row of data){if(result[row.kind])result[row.kind].push({...row.payload,project_id:projectId})}
   return result;
  },
  async saveItem(projectId,kind,itemId,payload,sortOrder=0){
   const user=await currentUser();
   if(!ITEM_KINDS.includes(kind))throw Error('Unknown item kind.');
   const {data,error}=await client.from('gp_items').upsert({
    project_id:projectId,kind,item_id:requireId(itemId,'Item ID'),
    payload:{...payload,project_id:projectId},sort_order:sortOrder,
    updated_at:new Date().toISOString(),updated_by:user.id
   },{onConflict:'project_id,kind,item_id'}).select('kind,item_id,updated_at').single();
   check(error);return data;
  },
  async deleteItem(projectId,kind,itemId){
   await currentUser();
   if(!ITEM_KINDS.includes(kind))throw Error('Unknown item kind.');
   const {error}=await client.from('gp_items').delete().eq('project_id',projectId).eq('kind',kind).eq('item_id',requireId(itemId,'Item ID'));
   check(error);
  },
  subscribeProject(projectId,onChange){
   const channel=client.channel('gameplan:'+projectId)
    .on('postgres_changes',{event:'*',schema:'public',table:'gp_items',filter:'project_id=eq.'+projectId},onChange)
    .subscribe();
   return ()=>{void client.removeChannel(channel)};
  },
  /* Copies a local project into a NEW cloud project, without deleting the original.
     Each item is stored as its own database row, preserving task sort order.
     Team assignments keep their existing local IDs; connecting them to signed-in
     Discord accounts is a separate step in the collaboration UI. */
  async importLocalProject(localData,localProjectId){
   const source=localData.projects?.find(p=>String(p.project_id)===String(localProjectId));
   if(!source)throw Error('Local project not found.');
   const user=await currentUser();
   const created=await this.createProject(source.project_name);
   const rows=[];
   const projectTaskIds=new Set((localData.tasks||[])
    .filter(task=>String(task.project_id)===String(localProjectId))
    .map(task=>String(task.task_id)));
   for(const kind of ITEM_KINDS){
    const items=Array.isArray(localData[kind])?localData[kind]:[];
    for(const [position,item] of items.entries()){
     // Time logs have a task_id rather than a project_id in local GamePlan.
     // Match via the owning task so the imported copy retains logged hours.
     const belongs=kind==='logs'
      ?projectTaskIds.has(String(item.task_id))
      :String(item.project_id)===String(localProjectId);
     if(!belongs)continue;
     const identifier=ID_FIELD[kind]||'id';
     const itemId=kind==='custom_tag_colors'?'color:'+item.color:kind==='team'?'member:'+item.member_id:String(item[identifier]||'');
     if(!itemId)continue;
     rows.push({project_id:created.id,kind,item_id:itemId,
      payload:{...item,project_id:created.id},sort_order:position,
      updated_by:user.id});
    }
   }
   try{
    for(let i=0;i<rows.length;i+=100){
     const {error}=await client.from('gp_items').upsert(rows.slice(i,i+100),{onConflict:'project_id,kind,item_id'});
     check(error);
    }
   }catch(err){
    // Do NOT silently delete a partial import: offer explicit recovery.
    throw Error('Project created, but importing some items failed. Review project '+created.id+' before retrying. '+err.message);
   }
   return {...created,importedItems:rows.length};
  }
 };
}
