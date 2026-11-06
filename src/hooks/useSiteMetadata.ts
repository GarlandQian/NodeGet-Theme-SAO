import { useEffect } from "react";
import { usePublicConfig } from "@/hooks/usePublicConfig";

function getDeploymentPath() {
  try {
    if (typeof window !== "undefined") {
      return new URL(import.meta.env.BASE_URL, window.location.href).pathname;
    }
  } catch {
    // 非浏览器预渲染环境可能没有完整 location。
  }
  return "/";
}
const deploymentPath = getDeploymentPath();
export const SITENAME_STORAGE_KEY = `nodeget-sao:sitename:${deploymentPath}`;
export const DESCRIPTION_STORAGE_KEY = `nodeget-sao:description:${deploymentPath}`;
export const FALLBACK_TITLE = "NodeGet-Theme-SAO";
export const FALLBACK_DESCRIPTION = "SAO dashboard theme for NodeGet.";

export function updateMeta(selector: string, attr: "content", value: string) {
  if (typeof document === "undefined") return;
  const element = document.querySelector<HTMLMetaElement>(selector);
  if (element) {
    element[attr] = value;
  }
}

export function readStoredSiteMetadata() {
  if (typeof localStorage === "undefined") {
    return { siteName: null, description: null };
  }
  try {
    const siteName = localStorage.getItem(SITENAME_STORAGE_KEY);
    const description = localStorage.getItem(DESCRIPTION_STORAGE_KEY);
    return {
      siteName: siteName?.trim() || null,
      description: description?.trim() || null,
    };
  } catch {
    return { siteName: null, description: null };
  }
}

export function persistSiteMetadata(siteName: string, description: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SITENAME_STORAGE_KEY, siteName);
    localStorage.setItem(DESCRIPTION_STORAGE_KEY, description);
  } catch {}
}

export function applySiteMetadata(siteName: string, description: string) {
  if (typeof document === "undefined") return;
  document.title = siteName;
  updateMeta('meta[name="apple-mobile-web-app-title"]', "content", siteName);
  updateMeta('meta[property="og:title"]', "content", siteName);
  updateMeta('meta[name="twitter:title"]', "content", siteName);
  updateMeta('meta[name="description"]', "content", description);
  updateMeta('meta[property="og:description"]', "content", description);
  updateMeta('meta[name="twitter:description"]', "content", description);
}

export function resolveSiteMetadata(
  configSiteName?: string | null,
  configDescription?: string | null,
  cachedSiteName?: string | null,
  cachedDescription?: string | null,
) {
  const siteName =
    configSiteName?.trim() || cachedSiteName?.trim() || FALLBACK_TITLE;
  const description =
    configDescription?.trim() ||
    cachedDescription?.trim() ||
    FALLBACK_DESCRIPTION;
  return { siteName, description };
}

export function useSiteMetadata() {
  const { data: config } = usePublicConfig();

  useEffect(() => {
    const cached = readStoredSiteMetadata();
    const { siteName, description } = resolveSiteMetadata(
      config?.sitename,
      config?.description,
      cached.siteName,
      cached.description,
    );

    applySiteMetadata(siteName, description);

    if (config?.sitename != null && config.sitename.trim() !== "") {
      persistSiteMetadata(siteName, description);
    }
  }, [config?.sitename, config?.description]);

  useEffect(() => {
    const logo = typeof config?.site_logo === "string" ? config.site_logo.trim() : "";
    const href = logo || `${import.meta.env.BASE_URL}favicon.svg`;
    for (const selector of ['link[rel="icon"]', 'link[rel="apple-touch-icon"]']) {
      document.querySelector<HTMLLinkElement>(selector)?.setAttribute("href", href);
    }
  }, [config?.site_logo]);
}
