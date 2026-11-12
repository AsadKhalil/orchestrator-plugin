import { Plugin } from '@opencode/plugin';
export default Plugin.define({id:'shell-interface-probe',async setup(ctx){try{
 const tools=await ctx.tool.list();for(const name of ['shell','shell_output','shell_kill','kill_shell','bash']){const tool=tools.find(t=>t.id===name);if(tool)console.log('SHELL_TOOL_INTERFACE',JSON.stringify({name,description:tool.description,input:tool.input}));}
 console.log('SHELL_DOMAIN_KEYS',JSON.stringify(Object.keys(ctx.shell)));
 }catch(e){console.log('SHELL_INTERFACE_ERROR',String(e));}}});
