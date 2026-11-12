import { Plugin } from '@opencode/plugin';
import { createRuntime } from '../node_modules/feature-pilot/dist/index.js';
import { getSelections, saveSelections } from '../node_modules/feature-pilot/dist/settings.js';
import { listProjectModels } from '../node_modules/feature-pilot/dist/inventory.js';
export default Plugin.define({ id:'selected-model-probe', async setup(ctx) {
 const runtime=await createRuntime(ctx);
 setTimeout(async()=>{try{
  const current=await getSelections(ctx.storage,ctx.location.directory);
  const choice={providerID:'smoke',id:'model-one',variant:'high'};
  const roles={planner:[choice],coder:[],reviewer:[]};
  await saveSelections(ctx.storage,ctx.location.directory,current.revision,roles,await listProjectModels(ctx));
  const stage={runID:'selection-probe',role:'planner',model:choice};
  let denied=false;try{await runtime.host.prepareStage({...stage,role:'coder'});}catch{denied=true;}
  const sessionID=await runtime.host.prepareStage(stage);
  await ctx.session.switchModel({sessionID,model:{providerID:'smoke',id:'model-one'}});
  let overrideDenied=false;try{await runtime.host.submitStagePrompt(sessionID,'selection-probe','msg_override','test');}catch(e){overrideDenied=String(e).includes('model changed');}
  await ctx.session.switchModel({sessionID,model:choice});
  const saved=await getSelections(ctx.storage,ctx.location.directory);
  await saveSelections(ctx.storage,ctx.location.directory,saved.revision,{planner:[],coder:[],reviewer:[]},await listProjectModels(ctx));
  let removedDenied=false;try{await runtime.host.submitStagePrompt(sessionID,'selection-probe','msg_removed','test');}catch(e){removedDenied=String(e).includes('not selected');}
  console.log('SELECTED_STAGE',JSON.stringify({unselectedRoleDenied:denied,sessionCreated:!!sessionID,overrideDenied,removedDenied}));
 }catch(e){console.log('SELECTED_STAGE_ERROR',String(e));}},1500);
 return ()=>runtime.dispose();
}});
