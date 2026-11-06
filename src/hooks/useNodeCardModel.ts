import { useMemo } from "react";
import { useHourlyClock, useMinuteClock } from "@/hooks/useClock";
import { useNodeCardSnapshots } from "@/hooks/useNode";
import {
  buildPingBuckets,
  useNodePingOverview,
  useNodePingOverviewLines,
  usePingBuckets,
} from "@/hooks/usePingOverview";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { usePriceVisibility } from "@/hooks/usePriceVisibility";
import { getCachedPublicPingTasks } from "@/services/api";
import type { HomepagePingDisplayLine, HomepagePingLine } from "@/types/models";
import { formatCompactRenewalPrice, formatRenewalPrice } from "@/utils/billing";
import { getExpireTextColor } from "@/utils/expireStatus";
import {
  formatBytes,
  formatByteRate,
  formatExpireDays,
  formatUptimeDays,
  joinDisplayParts,
  parseTags,
} from "@/utils/format";
import {
  resolveCustomLatencyColor,
  resolveCustomLossColor,
  trafficUsageColor,
} from "@/utils/metricTone";
import { resolveTrafficUsage, trafficTypeLabel, type TrafficDisplay } from "@/utils/traffic";
import { resolveOsInfo } from "@/components/ui/OsLogo";
import {
  hasHomepagePingTaskBinding,
  isFallbackTaskName,
  isHomepageMultiPingConfigured,
} from "@/utils/pingTasks";

interface NodeCardModelOptions {
  pingBucketCount?: number;
  includeMultiPing?: boolean;
}

export function shouldRenderHomepagePingBars(
  hasRealHomepagePingBinding: boolean,
  pingIsAssigned: boolean,
) {
  return hasRealHomepagePingBinding || pingIsAssigned;
}

export function useNodeCardModel(
  uuid: string,
  {
    pingBucketCount,
    includeMultiPing = false,
  }: NodeCardModelOptions = {},
) {
  const { meta, metrics, trafficTrend } = useNodeCardSnapshots(uuid);
  const {
    showCardGroup,
    homepagePingBindings,
    enableHomepageMultiPing,
    homepageMultiPingTaskIds,
    pingLatencyThresholds,
    pingLatencyColors,
    pingLossThresholds,
    pingLossColors,
  } = useThemeSettings();
  const { isPriceVisible } = usePriceVisibility();
  const multiPingConfigured =
    enableHomepageMultiPing &&
    isHomepageMultiPingConfigured(homepageMultiPingTaskIds);
  const multiPingActive = includeMultiPing && multiPingConfigured;
  const singlePingOverview = useNodePingOverview(uuid, !multiPingConfigured);
  const realPingLines = useNodePingOverviewLines(uuid, multiPingConfigured);
  const primaryMultiPingLine = useMemo(() => {
    if (!multiPingConfigured || multiPingActive) return undefined;
    const primaryTaskId = homepageMultiPingTaskIds[0];
    return realPingLines.find((line) => line.taskId === primaryTaskId);
  }, [homepageMultiPingTaskIds, multiPingActive, multiPingConfigured, realPingLines]);

  const realPing = primaryMultiPingLine ?? singlePingOverview;

  const hasRealHomepagePingBinding = useMemo(
    () =>
      realPing.isAssigned || multiPingConfigured || hasHomepagePingTaskBinding(uuid, homepagePingBindings),
    [homepagePingBindings, multiPingConfigured, realPing.isAssigned, uuid],
  );
  const now = useHourlyClock();
  const ping = realPing;
  // 状态跟随每条任务数据进入 Store,不再订阅全局 isRefreshing。这样后台轮询开始/结束
  // 时不会让所有节点卡片仅因一个布尔值变化而重渲染。
  const pingLoading =
    hasRealHomepagePingBinding && (ping.loadState ?? "pending") === "pending";
  const pingError =
    hasRealHomepagePingBinding && ping.loadState === "error";
  const shouldRenderPingBars = shouldRenderHomepagePingBars(
    hasRealHomepagePingBinding,
    ping.isAssigned,
  );
  const pingBuckets = usePingBuckets(
    ping,
    pingBucketCount,
    !multiPingActive,
  );
  // 与 usePingBuckets 同理:窗口按分钟前移,不依赖数据刷新才滑动。
  const bucketNow = useMinuteClock(multiPingActive);
  const homepagePingLines = useMemo<HomepagePingDisplayLine[]>(() => {
    if (
      !multiPingActive
    ) {
      return [];
    }
    return homepageMultiPingTaskIds.map((taskId) => {
      const loaded = realPingLines.find((line) => line.taskId === taskId);
      const cachedTask = getCachedPublicPingTasks()?.find((t) => t.id === taskId);
      const cachedName =
        cachedTask?.name && !isFallbackTaskName(cachedTask.name)
          ? cachedTask.name
          : undefined;
      const initialTaskName =
        loaded && !isFallbackTaskName(loaded.taskName)
          ? loaded.taskName
          : cachedName ?? loaded?.taskName ?? `任务 #${taskId}`;
      const line: HomepagePingLine = loaded
        ? loaded.taskName !== initialTaskName
          ? { ...loaded, taskName: initialTaskName }
          : loaded
        : {
            taskId,
            taskName: initialTaskName,
            client: uuid,
            isAssigned: true,
            loadState: "pending",
            lastValue: null,
            samples: [],
            max: 1,
            loss: null,
          };
      return {
        ...line,
        buckets: buildPingBuckets(line, pingBucketCount, bucketNow),
      };
    });
  }, [
    bucketNow,
    homepageMultiPingTaskIds,
    multiPingActive,
    pingBucketCount,
    realPingLines,
    uuid,
  ]);

  const metaModel = useMemo(() => {
    if (!meta) return null;
    const tags = parseTags(meta.tags);
    const group = showCardGroup ? meta.group : undefined;
    const subtitleParts = [group, meta.public_remark]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part));
    const subtitleLabels = new Set(subtitleParts.map((part) => part.toLowerCase()));
    const compactFooterTags = tags.filter(
      (tag) => !subtitleLabels.has(tag.label.trim().toLowerCase()),
    );
    const fallbackFooterTags =
      tags.length > 0
        ? tags
        : group
          ? [{ label: group, color: "gray" }]
          : [];
    return {
      tags,
      footerTags: fallbackFooterTags,
      compactFooterTags,
      subtitle: joinDisplayParts(subtitleParts),
      expire: formatExpireDays(meta.expired_at, now),
      expireColor: getExpireTextColor(meta.expired_at, now),
      isPriceVisible,
      renewalPrice: isPriceVisible && meta.price_configured !== false ? formatRenewalPrice(meta) : null,
      compactRenewalPrice: isPriceVisible && meta.price_configured !== false ? formatCompactRenewalPrice(meta) : null,
      osName: resolveOsInfo(meta.os).name,
      loadBaseline: meta.cpu_cores > 0 ? meta.cpu_cores : 4,
    };
  }, [isPriceVisible, meta, now, showCardGroup]);

  // ping 派生的颜色只在 ping item 或主题 ping 配置变化时才变。
  const pingModel = useMemo(
    () => ({
      latencyColor: resolveCustomLatencyColor(
        ping.lastValue,
        pingLatencyThresholds,
        pingLatencyColors,
      ),
      lossColor: resolveCustomLossColor(
        ping.loss,
        pingLossThresholds,
        pingLossColors,
      ),
      hasRealHomepagePingBinding,
      shouldRenderPingBars,
      pingLoading,
      pingError,
    }),
    [
      hasRealHomepagePingBinding,
      ping,
      pingError,
      pingLatencyColors,
      pingLatencyThresholds,
      pingLoading,
      pingLossColors,
      pingLossThresholds,
      shouldRenderPingBars,
    ],
  );

  return useMemo(() => {
    if (!meta || !metrics || !metaModel) {
      return {
        node: undefined,
        trafficTrend,
        ping,
        pingBuckets,
        homepagePingLines,
      };
    }

    const { loadBaseline } = metaModel;

    // 配额只使用周期快照；缺少快照时不能把开机计数器当作周期用量。
    const cycleUp = metrics.cycleUp ?? metrics.trafficUp;
    const cycleDown = metrics.cycleDown ?? metrics.trafficDown;
    const trafficUsage = resolveTrafficUsage(
      meta.traffic_limit_type,
      cycleUp,
      cycleDown,
      meta.traffic_limit,
    );
    const trafficUsedLabel = formatBytes(trafficUsage.used);
    // 不限量时渲染成 ∞，让剩余值和"已用/上限"那行与限量情况保持一致
    //（"剩余 ∞" + "2.73 GB / ∞"）。
    const trafficLimitLabel = trafficUsage.unlimited ? "∞" : formatBytes(trafficUsage.limit);
    const trafficColor = trafficUsage.unlimited
      ? "var(--status-success)"
      : trafficUsageColor(trafficUsage.fraction);
    const traffic: TrafficDisplay = {
      fraction: !trafficUsage.unlimited && metrics.cycleUp == null ? 0 : trafficUsage.fraction,
      color: trafficColor,
      remainingLabel: !trafficUsage.unlimited && metrics.cycleUp == null ? "暂无周期数据" : metrics.cyclePartial ? "周期数据不完整" : trafficUsage.unlimited ? "∞" : formatBytes(trafficUsage.remaining),
      detail: !trafficUsage.unlimited && metrics.cycleUp == null ? `— / ${trafficLimitLabel}` : `${trafficUsedLabel}${metrics.cyclePartial ? " *" : ""} / ${trafficLimitLabel}`,
      typeLabel: `${trafficTypeLabel(meta.traffic_limit_type)}${metrics.cyclePartial ? " · 周期数据不完整" : ""}`,
    };

    return {
      node: { ...meta, ...metrics },
      trafficTrend,
      ping,
      pingBuckets,
      homepagePingLines,
      traffic,
      ...metaModel,
      ...pingModel,
      uptime: formatUptimeDays(metrics.uptime),
      loadFraction: Math.max(0, Math.min(1, metrics.load1 / loadBaseline)),
      upRate: formatByteRate(metrics.netUp),
      downRate: formatByteRate(metrics.netDown),
      isOnline: metrics.online === true,
      isOffline: metrics.online === false,
    };
  }, [
    homepagePingLines,
    meta,
    metrics,
    metaModel,
    pingModel,
    ping,
    pingBuckets,
    trafficTrend,
  ]);
}
