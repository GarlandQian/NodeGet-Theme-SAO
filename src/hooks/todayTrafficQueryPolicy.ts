const TRAFFIC_STATS_REFRESH_MS = 5 * 60 * 1000;
const TRAFFIC_STATS_ERROR_RETRY_MS = 60 * 1000;

export function selectActiveTodayTrafficUuids(
  uuids: string[],
  activeUuids: ReadonlySet<string>,
) {
  return [...new Set(uuids.filter((uuid) => activeUuids.has(uuid)))];
}

export function getTodayTrafficRefreshInterval(
  hasData: boolean,
  hasError: boolean,
) {
  if (hasError) return TRAFFIC_STATS_ERROR_RETRY_MS;
  return hasData ? TRAFFIC_STATS_REFRESH_MS : false;
}
