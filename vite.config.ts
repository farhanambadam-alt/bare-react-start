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
  // Serve apple-app-site-association with correct content-type
  assetsInclude: [],
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/.well-known/apple-app-site-association') {
        _res.setHeader('Content-Type', 'application/json');
      }
      next();
    });
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
