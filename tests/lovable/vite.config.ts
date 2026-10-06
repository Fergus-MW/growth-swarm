import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const fixture = (name: string) => resolve(import.meta.dirname, name);
const boundaries = [
  {
    match: /(?:^@\/integrations\/supabase\/client$|\/integrations\/supabase\/client(?:\.ts)?$)/,
    file: "supabase-client.ts",
  },
  { match: /auth-middleware(?:\.ts)?$/, file: "auth-context.ts" },
  { match: /(?:^|\/)ai\.server(?:\.ts)?$/, file: "model.ts" },
  { match: /(?:^|\/)connectors\.server(?:\.ts)?$/, file: "connector.ts" },
];
export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    {
      name: "fixture-external-boundaries",
      enforce: "pre",
      resolveId(id) {
        const boundary = boundaries.find((item) => item.match.test(id));
        return boundary ? fixture(boundary.file) : null;
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      { find: "@tanstack/react-start", replacement: fixture("rpc.ts") },
      { find: "@", replacement: resolve(root, "src") },
    ],
  },
  define: { "process.env.TAVILY_API_KEY": JSON.stringify("fixture-only"), "process.env": "{}" },
  server: { host: "127.0.0.1", port: 4186, strictPort: true, fs: { allow: [root] } },
});
