import { Plugin } from '@opencode/plugin';
import { readHostDiff } from '../node_modules/feature-pilot/dist/diff.js';
export default Plugin.define({id:'vcs-diff-probe',setup(ctx){
 setTimeout(async()=>{try{const diff=await readHostDiff(ctx);console.log('VCS_DIFF_PROBE',JSON.stringify({files:diff.files.map(f=>f.file),warnings:diff.warnings,verified:diff.verifiedWorktreeIdentity}));}catch(e){console.log('VCS_DIFF_ERROR',String(e));}},1500);
}});
