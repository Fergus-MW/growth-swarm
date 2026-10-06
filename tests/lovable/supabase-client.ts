import { database } from "./runtime";

type Listener = {
  table: string;
  event: string;
  column?: string;
  value?: string;
  seen: number;
  callback: (payload: { new: unknown }) => void;
};

// Stands in for Supabase Realtime by watching the in-memory tables.
export const supabase = {
  ...database,
  auth: {
    getUser: async () => ({
      data: { user: { id: "fixture-user", email: "fixture@example.invalid" } },
      error: null,
    }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
  },
  channel() {
    const listeners: Listener[] = [];
    let timer: ReturnType<typeof setInterval> | undefined;
    const rows = (listener: Listener) =>
      (database.tables[listener.table as keyof typeof database.tables] ?? []).filter(
        (row) => !listener.column || String(row[listener.column]) === listener.value,
      );
    const channel = {
      on(
        _type: string,
        filter: { event: string; table: string; filter?: string },
        callback: Listener["callback"],
      ) {
        const [, column, value] = filter.filter?.match(/^(\w+)=eq\.(.+)$/) ?? [];
        const listener: Listener = {
          table: filter.table,
          event: filter.event,
          column,
          value,
          seen: 0,
          callback,
        };
        listener.seen = rows(listener).length;
        listeners.push(listener);
        return channel;
      },
      subscribe() {
        timer = setInterval(() => {
          for (const listener of listeners) {
            const current = rows(listener);
            if (current.length === listener.seen) continue;
            const added = current.slice(listener.seen);
            listener.seen = current.length;
            if (listener.event === "INSERT")
              added.forEach((row) => listener.callback({ new: structuredClone(row) }));
            else listener.callback({ new: null });
          }
        }, 400);
        return channel;
      },
      unsubscribe() {
        clearInterval(timer);
      },
    };
    return channel;
  },
  removeChannel(channel: { unsubscribe?: () => void }) {
    channel?.unsubscribe?.();
  },
};
