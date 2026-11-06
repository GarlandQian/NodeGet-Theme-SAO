import { useCallback, useSyncExternalStore } from "react";
import { useThemeSettings } from "@/hooks/useThemeSettings";

const PRICE_VISIBILITY_OVERRIDE_KEY = "nodeget-sao:price-visibility-override";

export type PriceVisibilityOverride = "visible" | "hidden" | null;

const listeners = new Set<() => void>();

export function resolvePriceVisibility(
  showPriceForGuests: boolean,
  override: PriceVisibilityOverride,
): boolean {
  return showPriceForGuests && override !== "hidden";
}

function readStoredOverride(): PriceVisibilityOverride {
  if (typeof window === "undefined") return null;
  try {
    const value = sessionStorage.getItem(PRICE_VISIBILITY_OVERRIDE_KEY);
    if (value === "visible" || value === "hidden") return value;
    return null;
  } catch {
    return null;
  }
}

let currentOverride: PriceVisibilityOverride = readStoredOverride();

function emit() {
  for (const listener of listeners) listener();
}

function writeStoredOverride(value: PriceVisibilityOverride) {
  currentOverride = value;
  try {
    if (value == null) {
      sessionStorage.removeItem(PRICE_VISIBILITY_OVERRIDE_KEY);
    } else {
      sessionStorage.setItem(PRICE_VISIBILITY_OVERRIDE_KEY, value);
    }
  } catch {
    // 忽略 sessionStorage 写入失败
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PriceVisibilityOverride {
  return currentOverride;
}

export function usePriceVisibility() {
  const themeSettings = useThemeSettings();
  const override = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const enabled = themeSettings.showPriceForGuests;
  // 防窥只能隐藏已公开的费用，不能打开站点未授权公开的资产数据。
  const isPriceVisible = resolvePriceVisibility(enabled, override);

  const togglePriceVisibility = useCallback(() => {
    if (!enabled) return;
    const next = override === "hidden" ? "visible" : "hidden";
    writeStoredOverride(next);
  }, [enabled, override]);

  const setPriceVisible = useCallback(
    (visible: boolean) => {
      if (!enabled) return;
      writeStoredOverride(visible ? "visible" : "hidden");
    },
    [enabled],
  );

  const resetPriceVisibilityOverride = useCallback(() => {
    writeStoredOverride(null);
  }, []);

  return {
    isPriceVisible,
    canToggle: enabled,
    togglePriceVisibility,
    setPriceVisible,
    resetPriceVisibilityOverride,
  };
}
