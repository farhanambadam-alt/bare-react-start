import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

function aasaPlugin(): Plugin {
  return {
    name: 'aasa-content-type',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/.well-known/apple-app-site-association') {
          res.setHeader('Content-Type', 'application/json');
        }
        next();
      });
    },
  };
}

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
    aasaPlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));