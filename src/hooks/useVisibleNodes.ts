import { useMemo } from "react";
import { useSourceSelection } from "@/hooks/useSourceSelection";
import { useAllNodeMeta } from "@/hooks/useNode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { collectMatchingNodeUuids } from "@/utils/nodeIdentity";
import type { NodeInfo } from "@/types/models";

let cachedMeta: NodeInfo[] | null = null;
let cachedHidden: string[] | null = null;
let cachedResult: Set<string> | null = null;

// 同帧内多个消费者(首页网格/overview 拉取/资产页/流量页)共享一次名称匹配解析。
function resolveHiddenNodeUuids(allMeta: NodeInfo[], hiddenNodes: string[]): Set<string> {
  if (cachedResult && cachedMeta === allMeta && cachedHidden === hiddenNodes) {
    return cachedResult;
  }
  cachedMeta = allMeta;
  cachedHidden = hiddenNodes;
  cachedResult = collectMatchingNodeUuids(allMeta, hiddenNodes);
  return cachedResult;
}

/** 主题级隐藏列表 → uuid 集合。名称匹配需要完整 meta。 */
export function useHiddenNodeUuids(): Set<string> {
  const allMeta = useAllNodeMeta();
  const themeSettings = useThemeSettings();
  const hiddenNodes = themeSettings.hiddenNodes;
  return useMemo(() => resolveHiddenNodeUuids(allMeta, hiddenNodes), [allMeta, hiddenNodes]);
}

/**
 * 公开页面统一排除隐藏节点，并应用主控筛选。
 */
export function useVisibleNodes(): NodeInfo[] {
  const allNodes = useAllNodeMeta();
  const selectedSource = useSourceSelection();
  const hiddenUuids = useHiddenNodeUuids();
  return useMemo(
    () =>
      allNodes.filter(
        (node) => !node.hidden && !hiddenUuids.has(node.uuid) && (!selectedSource || node.source_id === selectedSource),
      ),
    [allNodes, hiddenUuids, selectedSource],
  );
}
