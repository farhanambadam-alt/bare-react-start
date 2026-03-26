import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    // Serve apple-app-site-association with application/json content-type
    {
      name: 'aasa-content-type',
      configureServer(server: { middlewares: { use: (fn: Function) => void } }) {
        server.middlewares.use((req: { url?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
          if (req.url === '/.well-known/apple-app-site-association') {
            res.setHeader('Content-Type', 'application/json');
          }
          next();
        });
      },
    },
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
