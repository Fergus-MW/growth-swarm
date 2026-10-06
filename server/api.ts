import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import type { StreamEvent } from '../shared/types.ts';
import { ACTIVE_OUTCOMES } from '../shared/types.ts';
import { AppError, DEFAULT_SCHEMA, defaultConfig, validateConfig } from './config.ts';
import { Store } from './store.ts';
import { getConnectors } from './connectors.ts';
import { executeRun } from './engine.ts';
import { preflight } from './model.ts';
import { exportRunJson, exportVault, exportHtml } from './export.ts';

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[]=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>100_000)throw new AppError(413,'Request is too large.');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new AppError(400,'Expected valid JSON.');}
}
function json(res: ServerResponse, status: number, value: unknown) {res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
export function createApi(store: Store) {
  const session=randomBytes(32).toString('hex');
  const active=new Map<string,AbortController>();
  const port=Number(process.env.PORT||3001);
  const allowedOrigins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`,`http://127.0.0.1:${process.env.WEB_PORT||5173}`,`http://localhost:${process.env.WEB_PORT||5173}`]);
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    try {
      // Local-only service: rejects DNS rebinding and cross-origin browser requests.
      const host=req.headers.host||'';
      if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))throw new AppError(403,'This development backend accepts loopback hosts only.');
      if(req.headers.origin&&!allowedOrigins.has(req.headers.origin))throw new AppError(403,'Origin is not allowed.');
      const url=new URL(req.url||'/',`http://${host}`); const path=url.pathname;
      if(path==='/api/bootstrap'&&req.method==='GET'){
        res.setHeader('Set-Cookie',`growth_session=${session}; HttpOnly; SameSite=Strict; Path=/`);
        return json(res,200,{connectors:getConnectors(),schema:DEFAULT_SCHEMA,model:defaultConfig().model,mode:defaultConfig().mode,defaults:defaultConfig()});
      }
      if(path.startsWith('/api/')){
        if(!req.headers.cookie?.split(';').some(c=>c.trim()===`growth_session=${session}`))throw new AppError(401,'Open the application to initialize a local session.');
        if(path==='/api/runs'&&req.method==='GET')return json(res,200,store.list());
        if(path==='/api/runs'&&req.method==='POST'){
          const input=await body(req);const config=validateConfig(input.config||input,getConnectors(),!!input.parentId);
          const key=req.headers['idempotency-key'];if(typeof key!=='string'||key.length<8||key.length>200)throw new AppError(400,'A unique Idempotency-Key header is required.');
          if(input.parentId&&typeof input.parentId!=='string')throw new AppError(400,'Invalid parent run.');
          if(config.mode==='live')await preflight(config.model,AbortSignal.timeout(15000));
          return json(res,201,store.create(config,`local:${key}`,input.parentId));
        }
        const match=path.match(/^\/api\/runs\/([a-zA-Z0-9-]+)(?:\/(snapshot|execute|stop|export))?$/);
        if(!match)throw new AppError(404,'Route not found.');
        const [,id,action]=match;const run=store.getRun(id);
        if(!action&&req.method==='GET')return json(res,200,run);
        if(action==='snapshot'&&req.method==='GET')return json(res,200,store.getState(id));
        if(action==='stop'&&req.method==='POST'){store.requestStop(id);active.get(id)?.abort('stopped_by_user');return json(res,200,store.getRun(id));}
        if(action==='execute'&&req.method==='POST'){
          if(run.config.mode==='live' && store.list().some(r=>r.id!==id&&r.config.mode==='live'&&(active.has(r.id)||ACTIVE_OUTCOMES.includes(r.outcome))))throw new AppError(409,'One live run may execute at a time in the standalone backend. Stop the current run first.');
          const fence=store.claimExecution(id);const controller=new AbortController();active.set(id,controller);
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
          let buffered=false;let pending=false;let closed=false;
          const send=(event:StreamEvent)=>{
            if(closed||res.destroyed)return;
            if(buffered){pending=true;return;}
            buffered=!res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          };
          res.on('drain',()=>{buffered=false;if(pending){pending=false;const s=store.getState(id);send({type:'resync',sequence:s.run.sequence,revision:s.run.revision,data:s});}});
          send({type:'snapshot',sequence:run.sequence,revision:run.revision,data:store.getState(id)});
          const unsubscribe=store.subscribe(id,send);
          const heartbeat=setInterval(()=>{if(!buffered&&!closed)res.write(': heartbeat\n\n');},10000);
          res.on('close',()=>{closed=true;if(!res.writableEnded)controller.abort('disconnected');});
          try{await executeRun(store,id,fence,controller.signal);}catch(error){
            const current=store.getRun(id);
            if(ACTIVE_OUTCOMES.includes(current.outcome)){
              store.mutate(id,fence,s=>{s.run.error=error instanceof Error?error.message:'Execution failed.';});
              store.finish(id,fence,controller.signal.aborted?(store.getRun(id).stopRequested?'stopped_by_user':'disconnected'):'failed');
            }
          }finally{clearInterval(heartbeat);unsubscribe();active.delete(id);res.end();}
          return;
        }
        if(action==='export'&&req.method==='GET'){
          const state=store.readCheckpoint(id);const format=url.searchParams.get('format')||'json';
          let data:string|Uint8Array;let mime:string;let extension:string;
          if(format==='json'){data=exportRunJson(state);mime='application/json';extension='json';}
          else if(format==='html'){data=exportHtml(state);mime='text/html; charset=utf-8';extension='html';}
          else if(format==='vault'){
            const artifacts:Record<string,Uint8Array>={};
            for(const invocation of state.invocations) if(invocation.rawPath){
              const full=resolve(invocation.rawPath);
              if(full.startsWith(store.root+sep)&&existsSync(full))artifacts[`sources/raw/${invocation.id}.json`]=readFileSync(full);
            }
            data=exportVault(state,artifacts);mime='application/zip';extension='zip';
          } else throw new AppError(400,'Choose json, vault, or html.');
          res.writeHead(200,{'Content-Type':mime,'Content-Disposition':`attachment; filename="research-${id}.${extension}"`,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});res.end(data);return;
        }
        throw new AppError(405,'Method not allowed.');
      }
      if(req.method!=='GET')throw new AppError(405,'Method not allowed.');
      const root=resolve('dist/client');const candidate=resolve(root,`.${decodeURIComponent(path)}`);
      if(!candidate.startsWith(root+sep)&&candidate!==root)throw new AppError(403,'Invalid path.');
      const file=existsSync(candidate)&&extname(candidate)?candidate:resolve(root,'index.html');
      if(!existsSync(file))throw new AppError(404,'Run npm run dev, or npm run build before npm start.');
      const mime:Record<string,string>={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
      res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});res.end(readFileSync(file));
    }catch(error){
      if(!res.headersSent)json(res,error instanceof AppError?error.status:500,{error:error instanceof Error?error.message:'Unexpected server error.'});else res.end();
    }
  });
  server.requestTimeout=55*60*1000;server.headersTimeout=20000;
  return {server,abortAll:()=>{for(const controller of active.values())controller.abort('disconnected');},active};
}
