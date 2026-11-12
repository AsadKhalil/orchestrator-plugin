import http from 'node:http';
http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{let input;try{input=JSON.parse(body);}catch{return res.writeHead(400).end();}
const hasTool=input.messages?.some(m=>m.role==='tool');console.log('PLANNER_TOOL_REQUEST',JSON.stringify({hasTool,stream:input.stream}));
const base={id:'chatcmpl-synthetic',object:'chat.completion.chunk',created:1,model:input.model};
res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
const delta=hasTool?{role:'assistant',content:'{"kind":"questions","questions":[{"id":"q","question":"Which option?"}]}'}:{role:'assistant',tool_calls:[{index:0,id:'call_synthetic',type:'function',function:{name:'read',arguments:JSON.stringify({path:'planner-readable.txt'})}}]};
res.write(`data: ${JSON.stringify({...base,choices:[{index:0,delta,finish_reason:null}]})}\n\n`);
res.write(`data: ${JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:hasTool?'stop':'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})}\n\n`);res.end('data: [DONE]\n\n');});}).listen(46790,'127.0.0.1',()=>console.log('PLANNER_TOOL_READY'));
