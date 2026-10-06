export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(typeof body.error === 'string' ? body.error : body.error?.message || body.message || `Request failed (${response.status})`);
  }
  return response.json();
}

/** Parse streamed SSE frames across arbitrary UTF-8 and network chunk boundaries. */
export async function executeStream(id: string, onEvent: (event: unknown, name: string) => Promise<void>, signal: AbortSignal) {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}/execute`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error?.message || error.error || 'Could not start execution');
  }
  if (!response.body) throw new Error('The browser did not receive an execution stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const lines = frame.split('\n');
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        const name = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
        if (data) await onEvent(JSON.parse(data), name);
      }
      if (done) break;
    }
  } finally { reader.releaseLock(); }
}
