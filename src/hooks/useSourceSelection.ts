import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let selectedSource = "";

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function snapshot() { return selectedSource; }

export function setSelectedSource(sourceId: string) {
  if (sourceId === selectedSource) return;
  selectedSource = sourceId;
  for (const listener of listeners) listener();
}

/** 首页、资产、流量共享主控筛选；空字符串表示所有主控。 */
export function useSourceSelection() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
