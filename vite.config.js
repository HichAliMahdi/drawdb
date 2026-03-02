import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/db-introspect": {
        target: "http://localhost:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/db-introspect/, ""),
      },
    },
  },
});
