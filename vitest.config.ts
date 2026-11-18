import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      projects: [
        {
          extends: true,
          test: { name: "engine", environment: "node", include: ["tests/engine/**/*.test.ts"] },
        },
        {
          extends: true,
          test: {
            name: "ui",
            environment: "jsdom",
            include: ["tests/ui/**/*.test.{ts,tsx}"],
            setupFiles: ["tests/helpers/setupDom.ts"],
          },
        },
      ],
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.d.ts"],
        reporter: ["text-summary", "text", "html"],
      },
    },
  }),
);
