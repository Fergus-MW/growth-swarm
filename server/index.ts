import { existsSync } from 'node:fs';
import { Store } from './store.ts';
import { createApi } from './api.ts';
if(existsSync('.env'))process.loadEnvFile('.env');
const store=new Store();
const {server,abortAll,active}=createApi(store);
const port=Number(process.env.PORT||3001);
server.listen(port,'127.0.0.1',()=>console.log(`Growth Swarm API · http://127.0.0.1:${port} · local storage ${store.root}`));
let shuttingDown=false;
const shutdown=()=>{
  if(shuttingDown)return;shuttingDown=true;abortAll();server.close();
  const deadline=Date.now()+8000;
  const timer=setInterval(()=>{if(!active.size||Date.now()>deadline){clearInterval(timer);store.close();process.exit(0);}},100);
};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
