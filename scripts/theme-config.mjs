import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readConfigTemplate(root) {
  // 分发包始终取受版本控制的空连接模板，而不是当前部署的凭据。
  const template = JSON.parse(readFileSync(resolve(root, "public/config.json"), "utf8"));
  return { user_preferences: template.user_preferences, site_tokens: [] };
}

export function parseBuildConfig(raw, fallback) {
  if (!raw?.trim()) return fallback;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("NODEGET_CONFIG 必须是有效 JSON；配置内容不会输出到日志。");
  }
  if (!isObject(value) || !isObject(value.user_preferences) || !Array.isArray(value.site_tokens)) {
    throw new Error("NODEGET_CONFIG 需要 user_preferences 对象与 site_tokens 数组。");
  }
  for (const site of value.site_tokens) {
    if (!isObject(site) || typeof site.backend_url !== "string" || typeof site.token !== "string") {
      throw new Error("NODEGET_CONFIG 的主控条目需要 backend_url 和 token 字符串。");
    }
    try {
      const url = new URL(site.backend_url);
      if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password) {
        throw new Error();
      }
    } catch {
      throw new Error("NODEGET_CONFIG 中的 backend_url 必须是有效的 HTTP(S) 或 WS(S) 地址，不能包含用户名和密码。");
    }
  }
  return value;
}
