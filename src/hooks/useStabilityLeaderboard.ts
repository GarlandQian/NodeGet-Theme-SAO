import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMinuteClock } from "@/hooks/useClock";
import { useNodeGetCacheScope } from "@/hooks/useNodeGetCacheScope";
import { getNodePingWindowStats } from "@/services/api";
import type { YesterdayBestScope } from "@/types/models";
import { rankNodePingStats } from "@/utils/yesterdayBestNode";

const REFRESH_INTERVAL = 30 * 60_000;

export function useStabilityLeaderboard(candidateUuids: string[], scope: YesterdayBestScope, enabled: boolean) {
  const active = enabled && candidateUuids.length > 0;
  const clock = useMinuteClock(active);
  const cacheScope = useNodeGetCacheScope();
  const sortedCandidateUuids = useMemo(
    () => Array.from(new Set(candidateUuids)).sort(),
    [candidateUuids],
  );
  const dayKey = new Date(clock).toDateString();
  const query = useQuery({
    queryKey: ["nodeget-stability-raw", cacheScope, sortedCandidateUuids, dayKey],
    queryFn: ({ signal }) => getNodePingWindowStats(sortedCandidateUuids, 24, { signal }),
    enabled: active && Boolean(cacheScope),
    staleTime: REFRESH_INTERVAL,
    refetchInterval: REFRESH_INTERVAL,
  });
  const dateLabel = new Date(clock).toLocaleDateString("sv-SE");
  const data = useMemo(() => {
    if (!query.data) return undefined;
    return {
      ...rankNodePingStats(query.data.stats, candidateUuids, scope, dateLabel),
      issues: query.data.issues,
    };
  }, [candidateUuids, dateLabel, query.data, scope]);
  return {
    ...query,
    data,
  };
}
