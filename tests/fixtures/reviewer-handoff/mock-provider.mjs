import http from 'node:http';
http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{
 const input=JSON.parse(body), match=body.match(/[a-f0-9]{64}/);if(!match){res.writeHead(400).end();return;}
 const output=JSON.stringify({planHash:match[0],diffHash:'synthetic-diff',verdict:'approve',findings:[]});
 const base={id:'chatcmpl-review',object:'chat.completion.chunk',created:1,model:input.model};res.writeHead(200,{'Content-Type':'text/event-stream'});
 res.write(`data: ${JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:output},finish_reason:null}]})}\n\n`);
 res.write(`data: ${JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}})}\n\n`);res.end('data: [DONE]\n\n');console.log('REVIEW_MOCK_REQUEST');
 }catch{res.writeHead(400).end();}});}).listen(46790,'127.0.0.1',()=>console.log('REVIEW_MOCK_READY'));
