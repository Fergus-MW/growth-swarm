import { database } from "./runtime";
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
    const channel = {
      on() {
        return channel;
      },
      subscribe() {
        return channel;
      },
    };
    return channel;
  },
  removeChannel() {},
};
