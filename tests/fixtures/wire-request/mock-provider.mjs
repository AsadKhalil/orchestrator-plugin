import http from 'node:http';
http.createServer((req,res)=>{
 let body=''; req.on('data',chunk=>body+=chunk); req.on('end',()=>{
  let input; try { input=JSON.parse(body); } catch {res.writeHead(400).end();return;}
  console.log('LOCAL_MODEL_REQUEST',JSON.stringify({path:req.url,model:input.model,reasoning_effort:input.reasoning_effort,stream:input.stream}));
  if(input.stream) {
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
   const base={id:'chatcmpl-smoke',object:'chat.completion.chunk',created:1,model:input.model};
   res.write(`data: ${JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:'Local test response.'},finish_reason:null}]})}\n\n`);
   res.write(`data: ${JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})}\n\n`);
   res.end('data: [DONE]\n\n');
  } else {res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'chatcmpl-smoke',object:'chat.completion',created:1,model:input.model,choices:[{index:0,message:{role:'assistant',content:'Local test response.'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}));}
 });
}).listen(46790,'127.0.0.1',()=>console.log('LOCAL_MODEL_READY'));
