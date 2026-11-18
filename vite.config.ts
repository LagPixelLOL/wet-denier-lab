import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { consoleForwardPlugin } from "vite-console-forward-plugin";

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const isDev = command === "serve" || mode === "development";
  console.log(`Development mode: ${isDev}`);
  return {
    base: "./",
    plugins: [react(), tailwindcss(), isDev && consoleForwardPlugin()],
    server: { host: true, port: 12345, allowedHosts: true },
    build: {
      // three.js alone is about 740 kB minified.
      chunkSizeWarningLimit: 800,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: "three", test: /node_modules[\\/]three[\\/]/ },
              { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            ],
          },
        },
      },
    },
  };
});
