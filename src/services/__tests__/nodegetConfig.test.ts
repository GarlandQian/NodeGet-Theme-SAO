import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let configModule: typeof import("@/services/nodegetConfig");
const runtimeConfig = {
  user_preferences: {
    site_name: "SAO Test",
    site_logo: "/logo.svg",
    footer: "Test footer",
    futurePreference: { layout: ["a", "b"] },
    theme_settings: {
      showPriceForGuests: false,
      matrixColorTheme: "eva",
      userMatrixPresets: [{ id: "preset-1", name: "SAO", indices: [0, 20, 40] }],
      homepagePingTaskBindings: { "18": ["source-a:node-a"] },
      costPremiums: { "source-a:node-a": { amount: 10, paidCny: 100, acquiredAt: "2026-01-01" } },
    },
  },
  site_tokens: [{ id: "a", name: "Source A", backend_url: "wss://example.test/nodeget/rpc", token: "fixture-credential" }],
};

beforeEach(async () => {
  vi.resetModules();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
    removeItem: vi.fn((key: string) => storage.delete(key)),
  });
  vi.stubGlobal("window", {
    location: { href: "https://status.example.test/theme-a/#/assets" },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubEnv("BASE_URL", "./");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(runtimeConfig))));
  configModule = await import("@/services/nodegetConfig");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("NodeGet runtime configuration", () => {
  it("loads the deployment-relative configuration and shares the request", async () => {
    const [a, b] = await Promise.all([configModule.loadNodeGetConfig(), configModule.loadNodeGetConfig()]);
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://status.example.test/theme-a/config.json", expect.objectContaining({ cache: "no-store" }));
    expect(a.site_tokens[0].id).toBe("a");
  });

  it("does not abort another consumer when a caller is cancelled", async () => {
    let respond!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const controller = new AbortController();
    const first = configModule.loadNodeGetConfig({ signal: controller.signal });
    const second = configModule.loadNodeGetConfig();
    const aborted = expect(first).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    respond(new Response(JSON.stringify(runtimeConfig)));
    await aborted;
    expect((await second).user_preferences.site_name).toBe("SAO Test");
  });

  it("rejects invalid config without putting token data in the error", () => {
    expect(() => configModule.parseNodeGetConfig({ site_tokens: [{ backend_url: "javascript:bad", token: "fixture-credential" }] }))
      .toThrow("第 1 个主控地址需要 HTTP 或 WebSocket 地址");
    expect(() => configModule.parseNodeGetConfig({ site_tokens: "fixture-credential" }))
      .toThrow("site_tokens 必须是数组");
  });

  it("can retry after a failed read", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not found", { status: 404 }));
    await expect(configModule.loadNodeGetConfig()).rejects.toThrow("HTTP 404");
    expect((await configModule.loadNodeGetConfig()).site_tokens).toHaveLength(1);
  });
});

describe("local theme preferences", () => {
  it("round-trips complex settings and unknown future fields without connection credentials", async () => {
    const exported = await configModule.exportThemePreferences();
    expect(exported).not.toContain("fixture-credential");
    expect(exported).not.toContain("site_tokens");
    await configModule.importThemePreferences(exported);
    const result = JSON.parse(await configModule.exportThemePreferences());
    expect(result.futurePreference).toEqual(runtimeConfig.user_preferences.futurePreference);
    expect(result.theme_settings.userMatrixPresets).toEqual(runtimeConfig.user_preferences.theme_settings.userMatrixPresets);
    expect(result.theme_settings.homepagePingTaskBindings).toEqual(runtimeConfig.user_preferences.theme_settings.homepagePingTaskBindings);
    expect(result.theme_settings.costPremiums).toEqual(runtimeConfig.user_preferences.theme_settings.costPremiums);
  });

  it("imports a full config as preferences only and cannot locally enable site fees", async () => {
    const imported = structuredClone(runtimeConfig);
    imported.user_preferences.theme_settings.showPriceForGuests = true;
    imported.user_preferences.theme_settings.matrixColorTheme = "default";
    await configModule.importThemePreferences(JSON.stringify(imported));
    const config = await configModule.getThemePublicConfig();
    expect(config.theme_settings.showPriceForGuests).toBe(false);
    expect(config.theme_settings.matrixColorTheme).toBe("default");
    expect(localStorage.setItem).toHaveBeenCalledWith(expect.any(String), expect.not.stringContaining("fixture-credential"));
    expect(await configModule.exportThemePreferences()).not.toContain("site_tokens");
  });

  it("does not enable fees through a local save and retains deployment-authorized fees", async () => {
    await configModule.saveLocalThemeSettings({ showPriceForGuests: true, darkDepth: 50 });
    expect((await configModule.getThemePublicConfig()).theme_settings).toMatchObject({ showPriceForGuests: false, darkDepth: 50 });
    expect(configModule.resolveThemePreferences({ theme_settings: { showPriceForGuests: true } }, { theme_settings: { showPriceForGuests: false } }))
      .toMatchObject({ theme_settings: { showPriceForGuests: true } });
  });

  it("resets local settings to the deployment configuration", async () => {
    await configModule.saveLocalThemeSettings({ matrixColorTheme: "default", darkDepth: 50 });
    configModule.resetLocalThemeSettings();
    const config = await configModule.getThemePublicConfig();
    expect(config.theme_settings.matrixColorTheme).toBe("eva");
    expect(config.theme_settings.darkDepth).toBeUndefined();
  });

  it("isolates local settings for two deployments on one origin", async () => {
    await configModule.saveLocalThemeSettings({ darkDepth: 50 });
    window.location.href = "https://status.example.test/theme-b/#/";
    expect((await configModule.getThemePublicConfig()).theme_settings.darkDepth).toBeUndefined();
    expect(configModule.getThemeStorageKey()).toContain("/theme-b/config.json");
  });

  it("rejects malformed imports before replacing local preferences", async () => {
    await configModule.saveLocalThemeSettings({ darkDepth: 50 });
    await expect(configModule.importThemePreferences('{"theme_settings":[]}')).rejects.toThrow("theme_settings 必须是 JSON 对象");
    expect((await configModule.getThemePublicConfig()).theme_settings.darkDepth).toBe(50);
    expect(() => configModule.parseThemePreferencesImport('[1,2]')).toThrow("配置必须是 JSON 对象");
  });

  it("strips credential and prototype keys from arbitrary nested imports", () => {
    const prefs = configModule.parseThemePreferencesImport('{"theme_settings":{"future":{"token":"fixture-credential","color":"blue"},"__proto__":{"polluted":true}}}');
    expect(prefs).toEqual({ theme_settings: { future: { color: "blue" } } });
    expect({}).not.toHaveProperty("polluted");
  });

  it("reports failed persistence rather than claiming an in-memory save succeeded", async () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error("QuotaExceeded"); });
    await expect(configModule.saveLocalThemeSettings({ darkDepth: 75 })).rejects.toThrow("无法保存到当前浏览器");
    expect((await configModule.getThemePublicConfig()).theme_settings.darkDepth).toBeUndefined();
  });
});
