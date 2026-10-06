import { ArrowUpRight, Bot, Pin } from 'lucide-react';
import type { Agent, Invocation, Trace, Vote } from '../shared/types';

const statusLabels: Record<Agent['status'], string> = {
 idle: 'Idle', waiting: 'Waiting', working: 'Working', evaluating: 'Evaluating', done: 'Completed', error: 'Error',
};
const time = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function AgentPanel({ agent, traces, invocations, votes, pinned, onPin, onSelect }: {
 agent: Agent; traces: Trace[]; invocations: Invocation[]; votes: Vote[];
 pinned: boolean; onPin: () => void; onSelect: (id: string) => void;
}) {
 const latest = traces.at(-1);
 const nodeId = agent.nodeId || latest?.nodeId;
 return <article aria-label={agent.name} className={`trace-card agent-panel ${pinned ? 'pinned' : ''}`}>
  <div className="trace-title"><span><Bot size={13}/>{agent.name}</span><button aria-label={`${pinned ? 'Unpin' : 'Pin'} ${agent.name}`} aria-pressed={pinned} onClick={onPin}><Pin size={11}/></button></div>
  <div className={`agent-state ${agent.status}`}><span className="dot"/>{statusLabels[agent.status]}<span>{agent.completedTasks} tasks</span></div>
  <p className="agent-latest">{latest?.summary || agent.summary || 'Waiting for an available task.'}</p>
  {nodeId && <button onClick={() => onSelect(nodeId)}>View finding<ArrowUpRight size={10}/></button>}
  <details className="agent-history"><summary>Trace history ({traces.length})</summary><div className="agent-history-content">
   <p className="agent-display-note">Recorded activity and decision explanations. A separate reasoning summary is not provided.</p>
   {traces.length === 100 && <p className="agent-display-note">Showing the latest 100 activity entries for this agent.</p>}
   {traces.length ? <ol>{traces.map(trace => <li key={trace.id}>
    <div className="agent-entry-meta"><time dateTime={trace.timestamp}>{time(trace.timestamp)}</time> · {trace.status}{trace.connectorId && ` · ${trace.connectorId}`}</div>
    <p>{trace.summary || 'No display summary provided.'}</p>
    {trace.nodeId && <button onClick={() => onSelect(trace.nodeId!)}>View finding<ArrowUpRight size={10}/></button>}
   </li>)}</ol> : <p>No activity recorded yet.</p>}
  </div></details>
  <details className="agent-history"><summary>Source actions & results ({invocations.length})</summary><div className="agent-history-content">
   {invocations.length ? <ol>{invocations.map(invocation => <li key={invocation.id}>
    <div className="agent-entry-meta"><time dateTime={invocation.startedAt}>{time(invocation.startedAt)}</time> · {invocation.provider} · {invocation.operation} · {invocation.status.replaceAll('_', ' ')}</div>
    <p>{invocation.query}</p><p>{invocation.error || (invocation.status === 'pending' ? 'Awaiting source response.' : `${invocation.returnedCount} results · ${invocation.chunkIds.length} captured chunks${invocation.truncated ? ' · truncated capture' : ''}`)}</p>
    {invocation.chunkIds.map(id => <button key={id} onClick={() => onSelect(id)}>Inspect source<ArrowUpRight size={10}/></button>)}
   </li>)}</ol> : <p>No source actions recorded yet.</p>}
  </div></details>
  <details className="agent-history"><summary>Decision explanations ({votes.length})</summary><div className="agent-history-content">
   {votes.length ? <ol>{votes.map(vote => <li key={vote.epoch}>
    <div className="agent-entry-meta"><time dateTime={vote.createdAt}>{time(vote.createdAt)}</time> · {vote.yes ? 'Yes' : 'No'} · revision {vote.revision}</div><p>{vote.rationale || 'No decision explanation provided.'}</p>
   </li>)}</ol> : <p>No decision explanation recorded yet.</p>}
  </div></details>
 </article>;
}
