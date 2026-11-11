import http from 'node:http';
const {default:worker}=await import('../dist/server/index.js');
const port=Number(process.env.PORT||3000);
http.createServer(async(req,res)=>{try{const parts=[];for await(const chunk of req){parts.push(chunk);if(parts.reduce((n,b)=>n+b.length,0)>1000000)throw new Error('Request too large');}const body=Buffer.concat(parts);const request=new Request(`http://localhost:${port}${req.url}`,{method:req.method,headers:req.headers,...(body.length?{body}: {})});const response=await worker.fetch(request,{},{});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end('Server error');}}).listen(port,'127.0.0.1',()=>console.log(`StockIQ sandbox: http://localhost:${port}`));
