import { PublicConfigSchema, type PublicConfig } from "@/types/models";
import { withTimeoutSignal } from "@/utils/abort";

export interface NodeGetSiteToken {
  id?: string;
  name?: string;
  backend_url: string;
  token: string;
}

export interface NodeGetConfig {
  user_preferences: Record<string, unknown>;
  site_tokens: NodeGetSiteToken[];
}

type ConfigOptions = { signal?: AbortSignal };
const CONFIG_TTL_MS = 60_000;
const listeners = new Set<() => void>();
let cachedConfig: NodeGetConfig | undefined;
let cachedAt = 0;
let pendingConfig: Promise<NodeGetConfig> | undefined;
let memoryPreferences: Record<string, unknown> | undefined;
let memoryStorageKey: string | undefined;
let storageListenerAttached = false;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// 主题配置可以扩展任意 JSON 字段，但导入导出不携带连接凭据。
const PRIVATE_KEYS = new Set(["site_tokens", "token", "access_token", "refresh_token", "authorization", "api_key", "apikey", "password", "__proto__", "constructor", "prototype"]);
function cleanPreferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanPreferences);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PRIVATE_KEYS.has(key.toLowerCase()))
    .map(([key, entry]) => [key, cleanPreferences(entry)]));
}

export function getNodeGetConfigUrl(): string {
  const location = typeof window !== "undefined" ? window.location.href : "http://localhost/";
  const base = new URL(import.meta.env.BASE_URL || "./", location);
  return new URL("config.json", base).href;
}

export function getThemeStorageKey(): string {
  return `nodeget-sao:preferences:${getNodeGetConfigUrl()}`;
}

export function parseNodeGetConfig(value: unknown): NodeGetConfig {
  if (!isObject(value)) throw new Error("config.json 必须是 JSON 对象");
  if (value.user_preferences != null && !isObject(value.user_preferences)) {
    throw new Error("config.json 的 user_preferences 必须是对象");
  }
  if (isObject(value.user_preferences) && value.user_preferences.theme_settings != null && !isObject(value.user_preferences.theme_settings)) {
    throw new Error("config.json 的 theme_settings 必须是对象");
  }
  if (value.site_tokens != null && !Array.isArray(value.site_tokens)) {
    throw new Error("config.json 的 site_tokens 必须是数组");
  }
  const site_tokens = (value.site_tokens ?? []) as unknown[];
  const tokens = site_tokens.map((entry, index): NodeGetSiteToken => {
    if (!isObject(entry) || typeof entry.backend_url !== "string" || typeof entry.token !== "string") {
      throw new Error(`第 ${index + 1} 个主控配置需要 backend_url 和 token`);
    }
    let url: URL;
    try { url = new URL(entry.backend_url); }
    catch { throw new Error(`第 ${index + 1} 个主控地址格式不正确`); }
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password) {
      throw new Error(`第 ${index + 1} 个主控地址需要 HTTP 或 WebSocket 地址，且不能包含登录凭据`);
    }
    return {
      backend_url: entry.backend_url,
      token: entry.token,
      ...(typeof entry.id === "string" && entry.id.trim() ? { id: entry.id.trim() } : {}),
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
    };
  });
  return {
    user_preferences: cleanPreferences(value.user_preferences ?? {}) as Record<string, unknown>,
    site_tokens: tokens,
  };
}

function waitForConfig(promise: Promise<NodeGetConfig>, signal?: AbortSignal): Promise<NodeGetConfig> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
  });
}

export function loadNodeGetConfig(options?: ConfigOptions): Promise<NodeGetConfig> {
  if (options?.signal?.aborted) return Promise.reject(options.signal.reason);
  if (cachedConfig && Date.now() - cachedAt < CONFIG_TTL_MS) return Promise.resolve(cachedConfig);
  // 请求共享，但单个页面取消时不会中断其他消费者的配置加载。
  pendingConfig ??= withTimeoutSignal(async (signal) => {
    const response = await fetch(getNodeGetConfigUrl(), { cache: "no-store", signal });
    if (!response.ok) throw new Error(`无法读取站点配置（HTTP ${response.status}）`);
    let raw: unknown;
    try { raw = await response.json(); }
    catch {
      if (signal.aborted) throw signal.reason;
      throw new Error("config.json 不是有效的 JSON，请检查站点配置");
    }
    const config = parseNodeGetConfig(raw);
    cachedConfig = config;
    cachedAt = Date.now();
    return config;
  }, 12_000).finally(() => { pendingConfig = undefined; });
  return waitForConfig(pendingConfig, options?.signal);
}

function readLocalPreferences(): Record<string, unknown> {
  const key = getThemeStorageKey();
  if (memoryStorageKey === key && memoryPreferences) return memoryPreferences;
  memoryStorageKey = key;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    memoryPreferences = isObject(parsed) ? cleanPreferences(parsed) as Record<string, unknown> : {};
  } catch { memoryPreferences = {}; }
  return memoryPreferences;
}

function writeLocalPreferences(preferences: Record<string, unknown>) {
  const key = getThemeStorageKey();
  const sanitized = cleanPreferences(preferences) as Record<string, unknown>;
  // 存储失败需明确反馈，不能把仅存在内存中的内容报告为已保存。
  try { localStorage.setItem(key, JSON.stringify(sanitized)); }
  catch { throw new Error("无法保存到当前浏览器，请检查存储权限或导出配置保留改动"); }
  memoryPreferences = sanitized;
  memoryStorageKey = key;
  for (const listener of listeners) listener();
}

function siteThemeSettings(preferences: Record<string, unknown>): Record<string, unknown> {
  if (isObject(preferences.theme_settings)) return preferences.theme_settings;
  // 兼容将主题字段直接放在 user_preferences 中的配置。
  return Object.fromEntries(Object.entries(preferences).filter(([key]) => !["site_name", "site_logo", "footer", "description"].includes(key)));
}

export function resolveThemePreferences(
  sitePreferences: Record<string, unknown>,
  localPreferences: Record<string, unknown> = {},
): Record<string, unknown> {
  const site = siteThemeSettings(sitePreferences);
  const local = siteThemeSettings(localPreferences);
  return {
    ...sitePreferences,
    ...localPreferences,
    theme_settings: {
      ...site,
      ...local,
      // 费用公开与否只能由部署配置决定，本地偏好不能提升数据可见性。
      showPriceForGuests: site.showPriceForGuests === true,
    },
  };
}

export async function getThemePublicConfig(options?: ConfigOptions): Promise<PublicConfig> {
  const config = await loadNodeGetConfig(options);
  const prefs = resolveThemePreferences(config.user_preferences, readLocalPreferences());
  return PublicConfigSchema.parse({
    sitename: typeof prefs.site_name === "string" ? prefs.site_name : "NodeGet SAO",
    description: typeof prefs.description === "string" ? prefs.description : "NodeGet 服务器状态监控",
    site_logo: typeof prefs.site_logo === "string" ? prefs.site_logo : "",
    footer: typeof prefs.footer === "string" ? prefs.footer : "Powered by NodeGet",
    theme: "NodeGet-Theme-SAO",
    theme_settings: prefs.theme_settings,
  });
}

export async function saveLocalThemeSettings(settings: Record<string, unknown>): Promise<void> {
  if (!isObject(settings)) throw new Error("主题设置必须是 JSON 对象");
  const preferences = readLocalPreferences();
  const localSettings = { ...settings };
  delete localSettings.showPriceForGuests;
  writeLocalPreferences({ ...preferences, theme_settings: localSettings });
}

export function parseThemePreferencesImport(text: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("配置文件不是有效的 JSON"); }
  if (!isObject(parsed)) throw new Error("配置必须是 JSON 对象");
  const raw = "user_preferences" in parsed ? parsed.user_preferences : parsed;
  if (!isObject(raw)) throw new Error("user_preferences 必须是 JSON 对象");
  if (raw.theme_settings != null && !isObject(raw.theme_settings)) {
    throw new Error("theme_settings 必须是 JSON 对象");
  }
  const preferences = cleanPreferences(raw) as Record<string, unknown>;
  return "theme_settings" in preferences || ["site_name", "site_logo", "footer"].some((key) => key in preferences)
    ? preferences
    : { theme_settings: preferences };
}

export async function importThemePreferences(text: string): Promise<void> {
  const imported = parseThemePreferencesImport(text);
  // 仅将偏好导入浏览器，站点连接和费用公开标记均不会改变。
  const settings = { ...siteThemeSettings(imported) };
  delete settings.showPriceForGuests;
  writeLocalPreferences({ ...imported, theme_settings: settings });
}

export async function exportThemePreferences(settings?: Record<string, unknown>): Promise<string> {
  const config = await loadNodeGetConfig();
  const local = readLocalPreferences();
  const preferences = resolveThemePreferences(config.user_preferences, settings ? { ...local, theme_settings: settings } : local);
  return JSON.stringify(cleanPreferences(preferences), null, 2);
}

export function resetLocalThemeSettings(): void {
  try { localStorage.removeItem(getThemeStorageKey()); }
  catch { throw new Error("无法清除当前浏览器的主题设置"); }
  memoryPreferences = {};
  memoryStorageKey = getThemeStorageKey();
  for (const listener of listeners) listener();
}

export function subscribeThemePreferences(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageListenerAttached && typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("storage", handleStorageChange);
    storageListenerAttached = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && storageListenerAttached) {
      window.removeEventListener("storage", handleStorageChange);
      storageListenerAttached = false;
    }
  };
}

function handleStorageChange(event: StorageEvent) {
  if (event.key !== null && event.key !== getThemeStorageKey()) return;
  memoryPreferences = undefined;
  for (const listener of listeners) listener();
}

/** 配置文件更新后重新读取；不会清除用户的本地偏好。 */
export function invalidateNodeGetConfig(): void {
  cachedConfig = undefined;
  cachedAt = 0;
}
