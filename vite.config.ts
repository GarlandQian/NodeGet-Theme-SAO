import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const environment = loadEnv(mode, root, "NODEGET_");
  const rawConfig = process.env.NODEGET_CONFIG ?? environment.NODEGET_CONFIG;
  // 通过运行时文件提供配置，不把 NODEGET_CONFIG 放进前端 bundle。
  let developmentConfig = readFileSync(new URL("./public/config.json", import.meta.url), "utf8");
  if (rawConfig?.trim()) {
    try {
      const value = JSON.parse(rawConfig) as { user_preferences?: unknown; site_tokens?: unknown };
      if (!value || typeof value !== "object" || !value.user_preferences ||
          typeof value.user_preferences !== "object" || Array.isArray(value.user_preferences) ||
          !Array.isArray(value.site_tokens)) throw new Error();
      developmentConfig = JSON.stringify(value);
    } catch {
      throw new Error("NODEGET_CONFIG 需要有效 JSON、user_preferences 对象与 site_tokens 数组；配置内容不会输出到日志。");
    }
  }
  return {
    base: "./",
    plugins: [react(), tailwindcss(), {
      name: "nodeget-runtime-config",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.split("?")[0] !== "/config.json") return next();
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(developmentConfig);
        });
      },
    }],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    build: {
      // 与 CSS 实际基线对齐:全站大量 color-mix()/oklch(需 Chrome 111 / Safari 16.2+),
      // JS 没必要为更老的引擎转译。
      target: ["es2022", "chrome111", "safari16.2", "firefox113"],
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, "/");
            if (!normalized.includes("/node_modules/")) return;

            if (
              /\/node_modules\/(?:react|react-dom|react-router|react-router-dom)\//.test(
                normalized,
              )
            ) {
              return "react";
            }
            if (normalized.includes("/node_modules/@tanstack/react-query/")) {
              return "query";
            }
            if (/\/node_modules\/(?:uplot|uplot-react)\//.test(normalized)) {
              return "charts";
            }
            if (normalized.includes("/node_modules/zod/")) {
              return "validation";
            }
          },
        },
      },
    },
  };
});
