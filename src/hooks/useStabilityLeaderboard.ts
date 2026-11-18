import { useQuery } from "@tanstack/react-query";
import { useMinuteClock } from "@/hooks/useClock";
import { useNodeGetCacheScope } from "@/hooks/useNodeGetCacheScope";
import type { YesterdayBestScope } from "@/types/models";
import { calculateYesterdayBestLeaderboard } from "@/utils/yesterdayBestNode";

const REFRESH_INTERVAL = 30 * 60_000;

export function useStabilityLeaderboard(candidateUuids: string[], scope: YesterdayBestScope, enabled: boolean) {
  const active = enabled && candidateUuids.length > 0;
  const clock = useMinuteClock(active);
  const cacheScope = useNodeGetCacheScope();
  return useQuery({
    queryKey: ["nodeget-stability", cacheScope, scope, candidateUuids, new Date(clock).toDateString()],
    queryFn: ({ signal }) => calculateYesterdayBestLeaderboard(candidateUuids, { scope, signal }),
    enabled: active && Boolean(cacheScope),
    staleTime: REFRESH_INTERVAL,
    refetchInterval: REFRESH_INTERVAL,
  });
}
