import { useEffect, useRef, useState } from 'react';
import { Graph as Cosmos, PointShape, LinkStyle } from '@cosmos.gl/graph';
import Graph from 'graphology';
import Sigma from 'sigma';
import type { GraphEdge, GraphNode } from '../shared/types';

const colors={primary_entity:'#a5c97d',note:'#bdade7',source_chunk:'#8ebbd6'};
const rgba=(hex:string,alpha=1)=>[parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255,alpha];
const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export default function GraphView({nodes,edges,renderer,active,selectedId,onSelect,recenter,grouping,ringInset=0}:{nodes:GraphNode[];edges:GraphEdge[];renderer:'cosmos'|'sigma';active:boolean;selectedId:string|null;onSelect:(id:string)=>void;recenter:number;grouping:string;ringInset?:number}){
 const container=useRef<HTMLDivElement>(null);
 const cosmos=useRef<Cosmos|null>(null);
 const sigma=useRef<Sigma|null>(null);
 const graph=useRef<Graph|null>(null);
 const positions=useRef(new Map<string,[number,number]>());
 const indices=useRef(new Map<string,number>());
 const ids=useRef<string[]>([]);
 const select=useRef(onSelect);select.current=onSelect;
 const currentNodes=useRef(nodes);currentNodes.current=nodes;
 const buffers=useRef({capacity:0,positions:new Float32Array(0),colors:new Float32Array(0),sizes:new Float32Array(0),shapes:new Float32Array(0)});
 const [ready,setReady]=useState(0);
 const [fallback,setFallback]=useState(false);
 const [warning,setWarning]=useState('');
 const [labels,setLabels]=useState<{id:string;x:number;y:number;text:string}[]>([]);
 const touched=useRef(false);
 const lastGrouping=useRef(grouping);
 const firstFit=useRef(false);
 const previousIds=useRef('');
 const savePositions=()=>{if(cosmos.current?.isReady){const values=cosmos.current.getPointPositions();ids.current.forEach((id,i)=>{if(Number.isFinite(values[i*2])&&Number.isFinite(values[i*2+1]))positions.current.set(id,[values[i*2],values[i*2+1]]);});}if(graph.current)graph.current.forEachNode((id,attrs)=>positions.current.set(id,[attrs.x,attrs.y]));};
 useEffect(()=>{
  if(!container.current)return;let disposed=false;
  setFallback(false);setWarning('');previousIds.current='';firstFit.current=false;touched.current=false;
  try{
   if(renderer==='cosmos'){
    const instance=new Cosmos(container.current,{backgroundColor:'#131810',spaceSize:4096,enableSimulation:!reduced(),simulationFriction:.86,simulationRepulsion:.8,simulationLinkDistance:50,simulationLinkSpring:.15,simulationGravity:.05,simulationDecay:1500,pointDefaultSize:8,pointSamplingDistance:80,linkDefaultColor:'#647d4d',linkDefaultWidth:1,fitViewOnInit:false,rescalePositions:false,transitionDuration:0,enableDrag:true,onClick:index=>{if(index!==undefined&&ids.current[index])select.current(ids.current[index]);},onZoomStart:(_event,userDriven)=>{if(userDriven)touched.current=true;},onDragStart:()=>{touched.current=true;}});
    cosmos.current=instance;
    void instance.ready.then(()=>{if(!disposed)setReady(n=>n+1);}).catch(()=>{if(!disposed){setFallback(true);setWarning('WebGL unavailable. Showing the accessible graph fallback.');}});
   }else{
    const g=new Graph({multi:true,type:'directed'});graph.current=g;
    const instance=new Sigma(g,container.current,{allowInvalidContainer:true,renderLabels:true,labelColor:{color:'#d4dfc7'},labelSize:11,labelDensity:.18,labelGridCellSize:85,labelRenderedSizeThreshold:5,defaultEdgeColor:'#61734f',defaultNodeColor:'#a5c97d',stagePadding:40});sigma.current=instance;
    instance.on('clickNode',({node})=>select.current(node));setReady(n=>n+1);
   }
  }catch{setFallback(true);setWarning('WebGL unavailable. Showing the accessible graph fallback.');}
  return()=>{disposed=true;try{savePositions();}catch{/* GPU may have been lost. */}cosmos.current?.destroy();cosmos.current=null;sigma.current?.kill();sigma.current=null;graph.current=null;};
 },[renderer]);
 useEffect(()=>{
  if(fallback)return;let cancelled=false;let frame=0;
  frame=requestAnimationFrame(()=>{void(async()=>{
   const instance=cosmos.current;
   if(renderer==='cosmos'&&instance?.isReady){
    const signature=nodes.map(n=>n.id).join('|');const topologyChanged=signature!==previousIds.current;
    // Read current GPU positions only on topology changes, before buffer growth.
    if(topologyChanged&&previousIds.current){const saved=await instance.getPointPositionsAsync();if(cancelled||cosmos.current!==instance)return;ids.current.forEach((id,i)=>{if(Number.isFinite(saved[i*2])&&Number.isFinite(saved[i*2+1]))positions.current.set(id,[saved[i*2],saved[i*2+1]]);});}
    for(const node of nodes)if(!indices.current.has(node.id)){indices.current.set(node.id,ids.current.length);ids.current.push(node.id);}
    const length=ids.current.length;if(!length)return;
    if(buffers.current.capacity<length){const cap=Math.max(64,2**Math.ceil(Math.log2(length)));buffers.current={capacity:cap,positions:new Float32Array(cap*2),colors:new Float32Array(cap*4),sizes:new Float32Array(cap),shapes:new Float32Array(cap)};}
    const b=buffers.current;b.positions.fill(NaN);b.sizes.fill(0);b.colors.fill(0);
    nodes.forEach((node,i)=>{const index=indices.current.get(node.id)!;let position=positions.current.get(node.id);if(!position){const angle=i*2.399963;const radius=60+Math.sqrt(i)*30;position=[2048+Math.cos(angle)*radius,2048+Math.sin(angle)*radius];positions.current.set(node.id,position);}b.positions[index*2]=position[0];b.positions[index*2+1]=position[1];b.colors.set(rgba(colors[node.category],node.historical?.5:1),index*4);b.sizes[index]=node.category==='primary_entity'?12:node.category==='note'?9:6;b.shapes[index]=node.category==='primary_entity'?PointShape.Square:node.category==='note'?PointShape.Diamond:PointShape.Circle;});
    // Pass only the used slots. Removed slots are explicit NaNs, never phantom origin nodes.
    if(topologyChanged)instance.setPointPositions(b.positions.subarray(0,length*2),true);
    instance.setPointColors(b.colors.subarray(0,length*4));instance.setPointSizes(b.sizes.subarray(0,length));instance.setPointShapes(b.shapes.subarray(0,length));
    const liveIds=new Set(nodes.map(n=>n.id));const validEdges=edges.filter(e=>liveIds.has(e.source)&&liveIds.has(e.target));
    instance.setLinks(new Float32Array(validEdges.flatMap(edge=>[indices.current.get(edge.source)!,indices.current.get(edge.target)!])));
    instance.setLinkColors(new Float32Array(validEdges.flatMap(edge=>rgba(edge.polarity==='contradicts'?'#d99e86':edge.kind==='context'?'#56684a':'#8ca971',edge.kind==='context'?.35:.7))));
    instance.setLinkWidths(new Float32Array(validEdges.map(e=>e.kind==='evidence'?1.8:.8)));
    instance.setLinkStyles(new Float32Array(validEdges.map(e=>e.kind==='context'?LinkStyle.Dashed:LinkStyle.Solid)));
    instance.render(undefined,0);previousIds.current=signature;
    if(!firstFit.current){instance.fitView(0,.3,false);firstFit.current=true;}
    if(active&&!reduced())instance.unpause();
   }else if(renderer==='sigma'&&graph.current&&sigma.current){
    const g=graph.current;const nodeIds=new Set(nodes.map(n=>n.id));
    g.nodes().forEach(id=>{if(!nodeIds.has(id))g.dropNode(id);});
    const regroup=lastGrouping.current!==grouping;lastGrouping.current=grouping;
    const groups=[...new Set(nodes.map(n=>grouping==='kind'?(n.entityType||n.semanticKind||n.category):grouping==='source'?(n.source?.provider||n.provenance||'research'):n.category))];
    nodes.forEach((node,i)=>{let point=positions.current.get(node.id);if(!point||regroup){const key=grouping==='kind'?(node.entityType||node.semanticKind||node.category):grouping==='source'?(node.source?.provider||node.provenance||'research'):node.category;const group=groups.indexOf(key);point=[2048+Math.cos(group/groups.length*Math.PI*2)*150+Math.cos(i*2.4)*Math.sqrt(i)*15,2048+Math.sin(group/groups.length*Math.PI*2)*150+Math.sin(i*2.4)*Math.sqrt(i)*15];positions.current.set(node.id,point);}const attrs={x:point[0],y:point[1],label:`${node.category==='primary_entity'?'■':node.category==='note'?'◆':'●'} ${node.title}`,color:colors[node.category],size:node.category==='primary_entity'?9:node.category==='note'?6:4};if(g.hasNode(node.id))g.mergeNodeAttributes(node.id,attrs);else g.addNode(node.id,attrs);});
    const edgeIds=new Set(edges.map(e=>e.id));g.edges().forEach(id=>{if(!edgeIds.has(id))g.dropEdge(id);});edges.forEach(edge=>{if(!g.hasNode(edge.source)||!g.hasNode(edge.target))return;const attrs={color:edge.polarity==='contradicts'?'#d99e86':edge.kind==='context'?'#39482f':'#78965b',size:edge.kind==='evidence'?1.5:.5,label:`${edge.kind}: ${edge.relation} (${edge.polarity})`};if(g.hasEdge(edge.id))g.mergeEdgeAttributes(edge.id,attrs);else g.addEdgeWithKey(edge.id,edge.source,edge.target,attrs);});sigma.current.refresh();
   }
  })().catch(()=>{if(!cancelled){setFallback(true);setWarning('The GPU renderer could not update. Showing the accessible graph fallback.');}});});
  return()=>{cancelled=true;cancelAnimationFrame(frame);};
 },[nodes,edges,renderer,ready,fallback,active,grouping]);
 // Labels are a lightweight screen overlay; shapes remain rendered on the GPU.
 useEffect(()=>{
  if(renderer!=='cosmos'||fallback){setLabels([]);return;}
  const drawLabels=()=>{const instance=cosmos.current;if(!instance?.isReady||!container.current)return;try{
   const rect=container.current.getBoundingClientRect();const visible=new Map(currentNodes.current.map(n=>[n.id,n]));
   const next:{id:string;x:number;y:number;text:string}[]=[];
   for(const [index,position] of instance.getSampledPointPositionsMap()){
    const node=visible.get(ids.current[index]);if(!node||node.category==='source_chunk')continue;
    const [x,y]=instance.spaceToScreenPosition(position);
    if(x<ringInset+8||x>rect.width-ringInset-95||y<15||y>rect.height-20)continue;
    next.push({id:node.id,x:x+10,y:y-7,text:node.title.length>29?node.title.slice(0,28)+'…':node.title});
    if(next.length>=24)break;
   }setLabels(next);
  }catch{/* A context loss is reflected in the graph fallback. */}};
  const interval=setInterval(drawLabels,250);drawLabels();return()=>clearInterval(interval);
 },[renderer,ready,fallback,ringInset]);
 // Sample robust bounds at 5 Hz, then follow with a bounded critically damped camera.
 // Manual pan, zoom, drag, or focus yields control until explicit Recenter.
 useEffect(()=>{
  const instance=cosmos.current;
  if(renderer!=='cosmos'||!instance?.isReady||fallback||reduced())return;
  let disposed=false,inFlight=false,frame=0,last=0;
  let target:{x:number;y:number;logK:number}|null=null;
  let velocity={x:0,y:0,z:0};
  const started=performance.now();
  const sample=async()=>{
   if(disposed||inFlight||touched.current||(!active&&performance.now()-started>1200))return;
   inFlight=true;
   try{
    const values=await instance.getPointPositionsAsync();if(disposed)return;
    const xs:number[]=[],ys:number[]=[];
    for(const node of currentNodes.current){const index=indices.current.get(node.id);if(index===undefined)continue;const x=values[index*2],y=values[index*2+1];if(Number.isFinite(x)&&Number.isFinite(y)){xs.push(x);ys.push(y);}}
    if(!xs.length||!container.current)return;
    xs.sort((a,b)=>a-b);ys.sort((a,b)=>a-b);
    const lo=Math.floor((xs.length-1)*.02),hi=Math.ceil((xs.length-1)*.98);
    const rect=container.current.getBoundingClientRect();
    const spanX=Math.max(80,xs[hi]-xs[lo]),spanY=Math.max(80,ys[hi]-ys[lo]);
    const width=Math.max(100,rect.width-ringInset*2-28),height=Math.max(100,rect.height-40);
    const k=Math.min(8,Math.max(.03,Math.min(width/spanX,height/spanY)*.8));
    target={x:(xs[lo]+xs[hi])/2,y:(ys[lo]+ys[hi])/2,logK:Math.log10(k)};
   }catch{/* A lost GPU context is handled by the renderer fallback. */}finally{inFlight=false;}
  };
  const animate=(time:number)=>{
   if(disposed)return;frame=requestAnimationFrame(animate);
   const dt=Math.min(.05,Math.max(0,(time-(last||time))/1000));last=time;
   if(touched.current||!target||!container.current||!dt){velocity={x:0,y:0,z:0};return;}
   if(!active&&time-started>1800)return;
   const rect=container.current.getBoundingClientRect();if(rect.width<1||rect.height<1)return;
   const center=instance.screenToSpacePosition([rect.width/2,rect.height/2]);
   const k=instance.getZoomLevel();if(!Number.isFinite(k)||k<=0||!center.every(Number.isFinite))return;
   const logK=Math.log10(k),dx=target.x-center[0],dy=target.y-center[1],dz=target.logK-logK;
   if(Math.abs(dx)*k<rect.width*.02&&Math.abs(dy)*k<rect.height*.02&&Math.abs(dz)<Math.log10(1.02)){velocity={x:0,y:0,z:0};return;}
   const omega=6;
   velocity.x+=(omega*omega*dx-2*omega*velocity.x)*dt;
   velocity.y+=(omega*omega*dy-2*omega*velocity.y)*dt;
   velocity.z+=(omega*omega*dz-2*omega*velocity.z)*dt;
   const maxSpeed=Math.min(rect.width,rect.height)*.5/k;
   const speed=Math.hypot(velocity.x,velocity.y);if(speed>maxSpeed){velocity.x*=maxSpeed/speed;velocity.y*=maxSpeed/speed;}
   velocity.z=Math.max(-.8,Math.min(.8,velocity.z));
   const cx=center[0]+velocity.x*dt,cy=center[1]+velocity.y*dt,newK=Math.max(.03,Math.min(8,10**(logK+velocity.z*dt)));
   instance.setViewTransform({k:newK,x:rect.width/2-newK*(cx+(rect.width-4096)/2),y:rect.height/2-newK*((4096-cy)+(rect.height-4096)/2)});
  };
  void sample();const interval=setInterval(()=>void sample(),200);frame=requestAnimationFrame(animate);
  return()=>{disposed=true;clearInterval(interval);cancelAnimationFrame(frame);};
 },[renderer,ready,fallback,active,ringInset,recenter]);
 useEffect(()=>{if(!selectedId)return;if(cosmos.current?.isReady){const index=indices.current.get(selectedId);if(index!==undefined){cosmos.current.setConfigPartial({highlightedPointIndices:[index],outlinedPointIndices:[index]});cosmos.current.zoomToPointByIndex(index,reduced()?0:350,1.8,false,false);touched.current=true;}}if(sigma.current&&graph.current?.hasNode(selectedId)){const point=sigma.current.getNodeDisplayData(selectedId);if(point)sigma.current.getCamera().animate({x:point.x,y:point.y,ratio:.55},{duration:reduced()?0:300});}},[selectedId,renderer,ready]);
 useEffect(()=>{if(!recenter)return;touched.current=false;cosmos.current?.fitView(reduced()?0:350,.3,false);sigma.current?.getCamera().animatedReset({duration:reduced()?0:300});},[recenter]);
 useEffect(()=>{if(!cosmos.current)return;if(!active||reduced()){const timeout=setTimeout(()=>cosmos.current?.pause(),reduced()?0:900);return()=>clearTimeout(timeout);}},[active,ready]);
 return <><div ref={container} className="renderer" aria-label={`${renderer==='cosmos'?'Live Cosmos':'Sigma exploration'} graph with ${nodes.length} objects`} role="img"/>{!fallback&&renderer==='cosmos'&&<div className="graph-labels" aria-hidden="true">{labels.map(label=><span key={label.id} style={{left:label.x,top:label.y}}>{label.text}</span>)}</div>}{fallback&&<Fallback nodes={nodes} edges={edges} onSelect={onSelect}/>} {warning&&<div style={{position:'absolute',bottom:7,left:10,right:10,fontSize:9,color:'#a3b593',background:'#182111e8',padding:7,borderRadius:4}}>{warning}</div>}</>;
}
function Fallback({nodes,edges,onSelect}:{nodes:GraphNode[];edges:GraphEdge[];onSelect:(id:string)=>void}){
 const points=new Map(nodes.map((node,i)=>{const angle=i*2.399963;const radius=Math.min(190,45+Math.sqrt(i)*20);return[node.id,{x:350+Math.cos(angle)*radius*1.35,y:230+Math.sin(angle)*radius}];}));
 return <svg viewBox="0 0 700 460" className="node-svg" aria-label="Accessible graph fallback">{edges.map(edge=>{const s=points.get(edge.source),t=points.get(edge.target);return s&&t?<line key={edge.id} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={edge.polarity==='contradicts'?'#bc8370':'#587844'} strokeOpacity={.6} strokeDasharray={edge.kind==='context'?'4 5':undefined}/>:null;})}{nodes.map(node=>{const p=points.get(node.id)!;return <g key={node.id} role="button" tabIndex={0} aria-label={`${node.category.replaceAll('_',' ')}: ${node.title}`} onClick={()=>onSelect(node.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(node.id);}}}><title>{node.title}</title>{node.category==='source_chunk'?<circle cx={p.x} cy={p.y} r={5} fill={colors[node.category]}/>:<rect x={p.x-7} y={p.y-7} width={14} height={14} rx={node.category==='primary_entity'?3:1} transform={node.category==='note'?`rotate(45 ${p.x} ${p.y})`:undefined} fill={colors[node.category]}/>}<text x={p.x+11} y={p.y+3}>{node.title.length>27?node.title.slice(0,26)+'…':node.title}</text></g>;})}</svg>;
}
