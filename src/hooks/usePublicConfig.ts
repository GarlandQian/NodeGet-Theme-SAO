import { useQuery } from "@tanstack/react-query";
import { getPublic } from "@/services/api";
import type { PublicConfig } from "@/types/models";
import { subscribeThemePreferences } from "@/services/nodegetConfig";
import { queryClient } from "@/services/queryClient";

subscribeThemePreferences(() => {
  void queryClient.invalidateQueries({ queryKey: ["public"] });
});

export function usePublicConfig() {
  return useQuery<PublicConfig>({
    queryKey: ["public"],
    queryFn: ({ signal }) => getPublic({ signal }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
