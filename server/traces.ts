import type { Trace } from '../shared/types.ts';

export function retainAgentTraces(traces: Trace[]): Trace[] {
 const counts = new Map<string, number>();
 const retained: Trace[] = [];
 for (let index = traces.length - 1; index >= 0; index--) {
  const trace = traces[index];
  const count = (counts.get(trace.agentId) || 0) + 1;
  counts.set(trace.agentId, count);
  if (count <= 100) retained.push(trace);
 }
 return retained.reverse();
}
