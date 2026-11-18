import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { Features } from "lightningcss";
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
    css: {
      // Tailwind's optimizer turns rgba(..., 0.55) into 8-digit hex, which rounds the alpha to 1/255. The final
      // minify pass prints alpha colors as rgba() again, with the shortest alpha that maps to the same byte, so
      // two-decimal alphas come out exactly as written.
      lightningcss: { include: Features.HexAlphaColors },
    },
    build: {
      // three.js alone is about 740 kB minified.
      chunkSizeWarningLimit: 800,
      cssMinify: "lightningcss",
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
