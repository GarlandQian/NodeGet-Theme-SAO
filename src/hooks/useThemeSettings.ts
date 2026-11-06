import { useMemo } from "react";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { normalizeThemeSettings, type ResolvedThemeSettings } from "@/utils/themeSettings";

type ThemeSettingsState = ResolvedThemeSettings & {
  /**
   * 服务端 config 到达后为 true。config 请求失败时它也会变 true，
   * 让应用回退到默认值，而不是一直空白。
   */
  isReady: boolean;
  isLoading: boolean;
  isError: boolean;
};

export function useThemeSettings(): ThemeSettingsState {
  const { data: config, isError, isLoading } = usePublicConfig();
  const hasConfig = config != null;
  const isReady = hasConfig || isError;
  return useMemo(() => {
    // 配置层已合并本地偏好；加载失败时不恢复旧站点的费用公开状态。
    const base = normalizeThemeSettings(config?.theme_settings);
    let overrideClusterMode: "classic" | "nodes" | undefined;
    if (typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search);
      const clusterParam = searchParams.get("cluster");
      const matrixParam = searchParams.get("matrix");
      if (clusterParam === "nodes" || matrixParam === "1") {
        overrideClusterMode = "nodes";
      } else if (clusterParam === "classic") {
        overrideClusterMode = "classic";
      }
    }
    return {
      ...base,
      ...(overrideClusterMode ? { clusterOverviewMode: overrideClusterMode } : {}),
      isReady,
      isLoading: isLoading && !hasConfig,
      isError,
    };
  }, [config?.theme_settings, hasConfig, isError, isLoading, isReady]);
}
