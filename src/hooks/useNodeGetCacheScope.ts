import { useSyncExternalStore } from "react";
import { getNodeGetCacheScope, subscribeSourceStatuses } from "@/services/api";

export function useNodeGetCacheScope() {
  return useSyncExternalStore(subscribeSourceStatuses, getNodeGetCacheScope, getNodeGetCacheScope);
}
