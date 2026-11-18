import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, Upload, RotateCcw } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import type { OverviewData } from "@/components/node/OverviewStatCard";
import { useVisibleNodes } from "@/hooks/useVisibleNodes";
import { usePriceVisibility } from "@/hooks/usePriceVisibility";
import { useStabilityLeaderboard } from "@/hooks/useStabilityLeaderboard";
import { useHomeNodeSummaries } from "@/hooks/useNode";
import { useAllPingOverview } from "@/hooks/usePingOverview";
import { calculateCarrierLoss } from "@/utils/carrierLoss";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useHourlyClock, useMinuteClock } from "@/hooks/useClock";
import { useTodayTrafficStats, useHourlyTrafficBuckets } from "@/hooks/useTodayTrafficStats";
import { useThemeUpdate } from "@/hooks/useThemeUpdate";
import { usePreferences } from "@/hooks/usePreferences";
import { getNodeMetricsSnapshot } from "@/services/wsStore";
import {
  getPublicPingTasks,
  getNodes,
} from "@/services/api";
import { calculateYesterdayAverageScore } from "@/utils/yesterdayBestNode";
import {
  calculateCostSummary,
  getExchangeRates,
  readCachedExchangeRates,
} from "@/utils/cost";
import {
  dedupeGroupLabels,
  sortHomeGroupOptions,
} from "@/utils/homeNodes";
import { isHomepageMultiPingConfigured } from "@/utils/pingTasks";
import { normalizeThemeSettings } from "@/utils/themeSettings";
import { sortNodesByWeight } from "./components/CarrierLossConfigModal";

import {
  BODY_BOTTOM_GAP,
  DEFAULT_THEME_TAB,
  MIN_BODY_HEIGHT,
  THEME_TABS,
  isThemeTabId,
} from "./constants";
import { SiteSyncIndicator } from "./components/SiteSyncIndicator";
import { filterClients, localDateInputMax, sortClients, sortTasks } from "./utils";
import { useThemeManageDraft } from "./useThemeManageDraft";
import { OverviewTab } from "./tabs/OverviewTab";
import { ServerTab } from "./tabs/ServerTab";
import { CostTab } from "./tabs/CostTab";
import { OtherTab } from "./tabs/OtherTab";
import { HelpTab } from "./tabs/HelpTab";
import type { ThemeTabId } from "./types";

export function ThemeManage() {
  const now = useHourlyClock();
  const { currentVersion, hasUpdate } = useThemeUpdate();
  const { setAppearance } = usePreferences();
  const {
    data: config,
    isLoading: configLoading,
    error: configError,
    refetch: refetchConfig,
  } = usePublicConfig();

  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [taskSearch, setTaskSearch] = useState("");
  const [nodeSearch, setNodeSearch] = useState("");
  const [premiumSearch, setPremiumSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const rawTab = tabParam === "ping" ? "card" : tabParam === "help" ? "feedback" : tabParam;
  const activeTab: ThemeTabId = isThemeTabId(rawTab) ? rawTab : DEFAULT_THEME_TAB;
  const bodyRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);

  const openTab = useCallback(
    (next: ThemeTabId) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set("tab", next);
          return params;
        },
        { replace: true, preventScrollReset: true },
      );
      if (window.innerWidth >= 900) {
        sectionsRef.current?.scrollTo({ top: 0 });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [setSearchParams],
  );

  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const measure = () => {
      if (window.innerWidth < 900) {
        element.style.removeProperty("--theme-body-height");
        return;
      }
      const rect = element.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const main = element.closest("main");
      let padBottom = 0;
      for (
        let node: HTMLElement | null = element.parentElement;
        node && main && (node === main || main.contains(node));
        node = node.parentElement
      ) {
        const style = window.getComputedStyle(node);
        padBottom +=
          parseFloat(style.paddingBottom || "0") + parseFloat(style.borderBottomWidth || "0");
        if (node === main) break;
      }
      const footerHeight =
        document.querySelector(".site-footer")?.getBoundingClientRect().height ?? 0;
      const available = window.innerHeight - top - footerHeight - padBottom - BODY_BOTTOM_GAP;
      element.style.setProperty("--theme-body-height", `${Math.max(MIN_BODY_HEIGHT, available)}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    const topbar = document.querySelector(".theme-topbar");
    const footer = document.querySelector(".site-footer");
    if (topbar) observer.observe(topbar);
    if (footer) observer.observe(footer);
    return () => {
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, []);

  const {
    data: pingTasks,
    isLoading: tasksLoading,
    error: tasksError,
  } = useQuery({
    queryKey: ["public-ping-tasks"],
    queryFn: ({ signal }) => getPublicPingTasks({ signal }),
    staleTime: 30_000,
    retry: false,
  });

  const {
    data: themeNodes,
    isLoading: clientsLoading,
    error: clientsError,
  } = useQuery({
    queryKey: ["theme", "nodes"],
    queryFn: ({ signal }) => getNodes({ signal }),
    staleTime: 30_000,
    retry: false,
  });

  const sortedTasks = useMemo(() => sortTasks(pingTasks ?? []), [pingTasks]);
  const sortedClients = useMemo(() => sortClients((themeNodes ?? []).filter(node => !node.hidden)), [themeNodes]);
  const clientsById = useMemo(
    () => new Map(sortedClients.map((client) => [client.uuid, client])),
    [sortedClients],
  );

  const allMeta = useVisibleNodes();
  const { isPriceVisible } = usePriceVisibility();

  const sourceThemeSettings = useMemo(() => {
    return normalizeThemeSettings(config?.theme_settings);
  }, [config?.theme_settings]);

  const premiumRateQuery = useQuery({
    queryKey: ["cost-rates", sourceThemeSettings.costRateApiUrl],
    queryFn: ({ signal }) => getExchangeRates(sourceThemeSettings.costRateApiUrl, { signal }),
    initialData: () => readCachedExchangeRates(sourceThemeSettings.costRateApiUrl, true) ?? undefined,
    staleTime: 60 * 60 * 1000,
    enabled: isPriceVisible && allMeta.length > 0,
    retry: 1,
  });

  const premiumDetailByUuid = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateCostSummary>["details"][number]>();
    if (!isPriceVisible || !premiumRateQuery.data) return map;
    const summary = calculateCostSummary(
      allMeta,
      sourceThemeSettings.costIgnoredNodes,
      premiumRateQuery.data.rates,
      undefined,
      now,
    );
    for (const detail of summary.details) map.set(detail.uuid, detail);
    return map;
  }, [allMeta, now, sourceThemeSettings.costIgnoredNodes, premiumRateQuery.data, isPriceVisible]);

  const {
    draft,
    patch,
    patchBindings,
    patchPingLatencyThreshold,
    patchPingLatencyColor,
    resetPingLatency,
    patchPingLossThreshold,
    patchPingLossColor,
    resetPingLoss,
    patchTrafficSpectrumColor,
    applyStatusBarPreset,
    resetTrafficSpectrum,
    patchMultiPingTask,
    removeMultiPingTask,
    addMultiPingTask,
    setRatingLabelDraft,
    patchPremiumPaid,
    patchPremiumAcquiredAt,
    handleSave,
    syncPhase,
    draftAwaitingAutoSave,
    draftHiddenNodes,
    draftCostRateApiUrlInvalid,
    draftMultiPingInvalid,
    message,
    error,
    toastMessage,
    transferBusy,
    applyImportedOrSiteSettings,
    handleExport,
    importInputRef,
    showToast,
  } = useThemeManageDraft({
    config,
    allMeta,
    premiumDetailByUuid,
    premiumRates: premiumRateQuery.data?.rates,
    now,
    sortedTasks,
  });

  const location = useLocation();
  const toHome = useMemo(() => {
    const params = new URLSearchParams(location.search);
    params.delete("view");
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }, [location.search]);

  const availableGroups = useMemo(
    () => dedupeGroupLabels(sortedClients.map((client) => client.group)),
    [sortedClients],
  );
  const orderedDraftGroups = useMemo(
    () => sortHomeGroupOptions(availableGroups, draft.homeGroupOrder),
    [availableGroups, draft.homeGroupOrder],
  );

  const moveGroup = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= orderedDraftGroups.length) return;
    const next = [...orderedDraftGroups];
    [next[index], next[target]] = [next[target], next[index]];
    patch("homeGroupOrder", next);
  };

  const toggleTaskExpanded = useCallback((taskId: number) => {
    setExpandedTaskId((current) => (current === taskId ? null : taskId));
    setNodeSearch("");
  }, []);

  const visibleClients = useMemo(
    () => filterClients(sortedClients, nodeSearch),
    [nodeSearch, sortedClients],
  );
  const filteredPremiumClients = useMemo(
    () => filterClients(sortedClients, premiumSearch),
    [premiumSearch, sortedClients],
  );

  const filteredTasks = useMemo(() => {
    const keyword = taskSearch.trim().toLowerCase();
    if (!keyword) return sortedTasks;
    return sortedTasks.filter((task) => {
      return (
        task.name.toLowerCase().includes(keyword) ||
        String(task.id).includes(keyword) ||
        task.type.toLowerCase().includes(keyword) ||
        task.target.toLowerCase().includes(keyword)
      );
    });
  }, [sortedTasks, taskSearch]);

  const canAddMultiPingTask = sortedTasks.some(
    (task) => !draft.homepageMultiPingTaskIds.includes(task.id),
  );

  const nodeSummaries = useHomeNodeSummaries();
  const allPing = useAllPingOverview();
  const isMultiPingConfigured =
    draft.enableHomepageMultiPing &&
    isHomepageMultiPingConfigured(draft.homepageMultiPingTaskIds);

  const carrierLoss = useMemo(() => {
    if (!isMultiPingConfigured) {
      return {
        peakLoss: null,
        avgLoss: null,
        ct: { loss: null, count: 0 },
        cu: { loss: null, count: 0 },
        cm: { loss: null, count: 0 },
        hasAnyData: false,
        isMultiPingMode: false,
      };
    }
    const hasIncludedFilter =
      Array.isArray(draft.carrierLossIncludedNodes) && draft.carrierLossIncludedNodes.length > 0;

    let targetNodes = allMeta;
    if (hasIncludedFilter) {
      const includedSet = new Set(draft.carrierLossIncludedNodes);
      targetNodes = allMeta.filter(
        (node) => includedSet.has(node.uuid) || (node.name && includedSet.has(node.name)),
      );
    }
    const targetUuids = targetNodes.map((node) => node.uuid);

    return calculateCarrierLoss(
      allPing.multiLines,
      allPing.singleItems,
      targetUuids,
      true,
    );
  }, [allPing.multiLines, allPing.singleItems, isMultiPingConfigured, draft.carrierLossIncludedNodes, allMeta]);

  // 严格按后台权重与名称排序所有节点，保证与配置弹窗/天梯榜中的 #X 序号严格一致
  const sortedAllMeta = useMemo(() => sortNodesByWeight(allMeta), [allMeta]);

  // 计算设置页「昨日最佳」有效候选节点
  const yesterdayCandidateNodes = useMemo(() => {
    const included = draft.yesterdayBestIncludedNodes;
    if (included && included.length > 0) {
      const includedSet = new Set(included);
      return sortedAllMeta.filter((node) => includedSet.has(node.uuid) || (node.name && includedSet.has(node.name)));
    }
    return sortedAllMeta;
  }, [sortedAllMeta, draft.yesterdayBestIncludedNodes]);

  const yesterdayScope = draft.yesterdayBestScope ?? "tri";
  const yesterdayDisplayMode = draft.yesterdayBestDisplayMode ?? "best";
  const yesterdayCandidateUuids = useMemo(() => yesterdayCandidateNodes.map((n) => n.uuid), [yesterdayCandidateNodes]);

  const stabilityQuery = useStabilityLeaderboard(
    yesterdayCandidateUuids, yesterdayScope, activeTab === "home" && draft.showHomeOverview,
  );
  const yesterdayBestResult = stabilityQuery.data?.best;
  const yesterdayLeaderboard = stabilityQuery.data?.leaderboard;

  const yesterdayBestDisplay = useMemo(() => {
    if (yesterdayCandidateNodes.length === 0) return null;

    if (yesterdayDisplayMode === "average") {
      const avgResult = calculateYesterdayAverageScore(yesterdayLeaderboard ?? []);
      if (avgResult) {
        return {
          nodeIndexText: "集群均分",
          nodeName: `${avgResult.nodeCount} 台参评`,
          score: avgResult.score,
          avgLatency: avgResult.avgLatency,
          avgLoss: avgResult.avgLoss,
          scope: yesterdayScope,
          mode: yesterdayDisplayMode,
        };
      }
    }

    if (yesterdayBestResult) {
      const targetUuid = yesterdayBestResult.uuid;
      const targetIndex = sortedAllMeta.findIndex((n) => n.uuid === targetUuid);
      const nodeIndexText = targetIndex >= 0 ? `#${targetIndex + 1}` : "#--";
      const targetNode = sortedAllMeta.find((n) => n.uuid === targetUuid);
      const nodeName = targetNode?.name?.trim() || targetUuid;

      return {
        nodeIndexText,
        nodeName,
        score: yesterdayBestResult.score,
        avgLatency: yesterdayBestResult.avgLatency,
        avgLoss: yesterdayBestResult.avgLoss,
        scope: yesterdayScope,
        mode: yesterdayDisplayMode,
      };
    }

    return null;
  }, [
    yesterdayCandidateNodes,
    yesterdayBestResult,
    yesterdayLeaderboard,
    yesterdayDisplayMode,
    sortedAllMeta,
    yesterdayScope,
  ]);

  const realOverview = useMemo<OverviewData | undefined>(() => {
    let onlineNodes = 0;
    let offlineNodes = 0;
    let trafficUp = 0;
    let trafficDown = 0;
    let netUp = 0;
    let netDown = 0;
    let totalCpu = 0;
    let totalRamUsed = 0;
    let totalRamTotal = 0;
    let totalSwapUsed = 0;
    let totalSwapTotal = 0;
    let totalDiskUsed = 0;
    let totalDiskTotal = 0;
    let totalTcpConn = 0;
    let totalUdpConn = 0;
    let totalProcesses = 0;

    if (nodeSummaries && nodeSummaries.length > 0) {
      const visibleUuids = new Set(allMeta.map(node => node.uuid));
      for (const node of nodeSummaries) {
        if (!visibleUuids.has(node.uuid)) continue;
        if (node.online === true) onlineNodes++;
        else if (node.online === false) offlineNodes++;

        trafficUp += node.trafficUp || 0;
        trafficDown += node.trafficDown || 0;
        netUp += node.netUp || 0;
        netDown += node.netDown || 0;
        totalCpu += node.cpuPct || 0;
        totalRamUsed += node.ramUsed || 0;
        totalRamTotal += node.ramTotal || 0;
        totalSwapUsed += node.swapUsed || 0;
        totalSwapTotal += node.swapTotal || 0;
        totalDiskUsed += node.diskUsed || 0;
        totalDiskTotal += node.diskTotal || 0;
        totalTcpConn += node.connectionsTcp || 0;
        totalUdpConn += node.connectionsUdp || 0;
        totalProcesses += node.process || 0;
      }
    }

    const totalNodes = allMeta.length;
    const avgCpu = onlineNodes > 0 ? totalCpu / onlineNodes : 0;

    let minUptimeSeconds = Number.POSITIVE_INFINITY;
    let recentRebootNode: { name: string; seconds: number } | null = null;

    for (const meta of allMeta) {
      const metrics = getNodeMetricsSnapshot(meta.uuid);
      if (metrics && metrics.online === true && Number.isFinite(metrics.uptime) && metrics.uptime > 0) {
        if (metrics.uptime < minUptimeSeconds) {
          minUptimeSeconds = metrics.uptime;
          recentRebootNode = {
            name: meta.name?.trim() || meta.uuid,
            seconds: metrics.uptime,
          };
        }
      }
    }

    return {
      totalNodes,
      onlineNodes,
      offlineNodes,
      trafficUp,
      trafficDown,
      netUp,
      netDown,
      avgCpu,
      totalRamUsed,
      totalRamTotal,
      ramPct: totalRamTotal > 0 ? (totalRamUsed / totalRamTotal) * 100 : 0,
      totalDiskUsed,
      totalDiskTotal,
      diskPct: totalDiskTotal > 0 ? (totalDiskUsed / totalDiskTotal) * 100 : 0,
      totalTcpConn,
      totalUdpConn,
      totalSwapUsed,
      totalSwapTotal,
      swapPct: totalSwapTotal > 0 ? (totalSwapUsed / totalSwapTotal) * 100 : 0,
      totalProcesses,
      totalCores: allMeta.length > 0 ? allMeta.reduce((sum, n) => sum + (n.cpu_cores || 0), 0) : 0,
      recentRebootNode,
      carrierLoss,
      yesterdayBestScope: yesterdayScope,
      yesterdayBest: yesterdayBestDisplay,
    };
  }, [nodeSummaries, allMeta, carrierLoss, yesterdayScope, yesterdayBestDisplay]);

  const realCostSummary = useMemo(() => {
    if (!isPriceVisible || !premiumRateQuery.data || allMeta.length === 0) return null;
    return calculateCostSummary(
      allMeta,
      sourceThemeSettings.costIgnoredNodes,
      premiumRateQuery.data.rates,
      undefined,
      now,
    );
  }, [allMeta, now, sourceThemeSettings.costIgnoredNodes, premiumRateQuery.data, isPriceVisible]);

  const trafficUuids = useMemo(() => allMeta.map((n) => n.uuid), [allMeta]);
  const todayTrafficClock = useMinuteClock();
  const todayTrafficQuery = useTodayTrafficStats(trafficUuids, todayTrafficClock, "summary");
  const latestTrafficTotal = useMemo(() => {
    if (!todayTrafficQuery.data?.rows.some(row => row.trafficAvailable)) return null;
    return todayTrafficQuery.data.rows.reduce(
      (sum, row) => sum + row.trafficUp + row.trafficDown,
      0,
    );
  }, [todayTrafficQuery.data]);
  const todayTrafficTotal = latestTrafficTotal;
  const hourlyTrafficQuery = useHourlyTrafficBuckets(
    trafficUuids, todayTrafficClock, activeTab === "home" && draft.showHomeOverview &&
      !draft.overviewStaticCards.includes("traffic"),
  );
  const todayTrafficHourly = hourlyTrafficQuery.data ?? null;

  if (configLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div role="alert" className="space-y-2">
          <div className="text-[15px] font-semibold text-(--text-primary)">无法读取主题配置</div>
          <p className="max-w-lg text-[13px] text-(--text-secondary)">
            {configError instanceof Error ? configError.message : "请稍后重试。"}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => void refetchConfig()}
            className="control-button px-4 py-2 text-[13px] font-medium"
          >
            重试
          </button>
          <Link to={toHome} className="control-button px-4 py-2 text-[13px] font-medium">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  const dataError =
    (tasksError instanceof Error ? tasksError.message : null) ||
    (clientsError instanceof Error ? clientsError.message : null);
  const noTasksYet = !tasksLoading && !clientsLoading && sortedTasks.length === 0;
  const noFilteredTaskMatch =
    !tasksLoading && !clientsLoading && !noTasksYet && filteredTasks.length === 0;

  const acquiredAtMax = localDateInputMax();

  return (
    <div className="theme-manage flex flex-col gap-5 py-2">
      {/* 右上角悬浮气泡 Toast */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-5 right-5 z-9999 flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-2xl border border-emerald-500/35 bg-(--bg-card)/95 backdrop-blur-md text-xs font-semibold text-emerald-600 dark:text-emerald-400 pointer-events-auto"
        >
          <span className="flex h-2 w-2 relative shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => showToast("")}
            className="ml-1 text-(--text-muted) hover:text-(--text-primary) transition-colors text-xs leading-none"
            title="关闭通知"
          >
            ✕
          </button>
        </div>
      )}

      <header className="theme-topbar">
        <Link to={toHome} className="instance-page-back theme-topbar-back">
          <ArrowLeft size={14} />
          <span>返回首页</span>
        </Link>
        <h1 className="theme-topbar-title">主题设置</h1>
        <div className="theme-manage-toolbar-actions">
          <SiteSyncIndicator
            phase={syncPhase}
            invalid={draftCostRateApiUrlInvalid || draftMultiPingInvalid}
            waiting={draftAwaitingAutoSave}
            onRetry={() => void handleSave()}
          />
        </div>
      </header>

      <section className="surface-inset rounded-xl px-4 py-3 flex flex-wrap items-center gap-3" aria-label="主题配置导入导出">
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-[13px] font-medium text-(--text-primary)">这里的修改只影响当前浏览器</p>
          <p className="mt-1 text-[12px] leading-relaxed text-(--text-secondary)">
            需要全站生效时，导出后将内容完整替换到 NodeGet 主题配置的 user_preferences；独立部署时替换 config.json 中同名字段。连接信息和 Token 不会导出。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void handleExport()} disabled={transferBusy || draftCostRateApiUrlInvalid || draftMultiPingInvalid} className="control-button flex items-center gap-1.5 px-3 py-2 text-[12px] disabled:opacity-50">
            <Download size={14} />导出配置
          </button>
          <button type="button" onClick={() => importInputRef.current?.click()} disabled={transferBusy || syncPhase === "saving"} className="control-button flex items-center gap-1.5 px-3 py-2 text-[12px] disabled:opacity-50">
            <Upload size={14} />导入配置
          </button>
          <button type="button" onClick={() => void applyImportedOrSiteSettings()} disabled={transferBusy || syncPhase === "saving"} className="control-button flex items-center gap-1.5 px-3 py-2 text-[12px] disabled:opacity-50">
            <RotateCcw size={14} />恢复站点设置
          </button>
          <input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void applyImportedOrSiteSettings(file);
          }} />
        </div>
      </section>

      {(message || error || dataError) && (
        <div className="flex flex-col gap-3">
          {message && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-xl border border-[color-mix(in_srgb,var(--status-online)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-online)_11%,var(--surface))] px-4 py-3 text-[13px] text-(--status-online)"
            >
              {message}
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-[color-mix(in_srgb,var(--status-offline)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-offline)_11%,var(--surface))] px-4 py-3 text-[13px] text-(--status-offline)"
            >
              {error}
            </div>
          )}
          {dataError && (
            <div
              role="alert"
              className="rounded-xl border border-[color-mix(in_srgb,var(--status-offline)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-offline)_11%,var(--surface))] px-4 py-3 text-[13px] text-(--status-offline)"
            >
              部分 Ping 任务或节点信息不可用，仍可编辑其他设置。 {dataError}
            </div>
          )}
        </div>
      )}

      <div className="theme-manage-body" ref={bodyRef}>
        <nav className="theme-tab-rail" aria-label="设置分组">
          {THEME_TABS.map(({ id, label, hint, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => openTab(id)}
              data-active={activeTab === id ? "true" : "false"}
              aria-current={activeTab === id ? "page" : undefined}
              className="theme-tab"
            >
              <Icon size={14} className="theme-tab-icon" />
              <span className="theme-tab-label">
                {label}
                {id === "feedback" && hasUpdate && (
                  <span className="theme-tab-badge-dot" aria-label="有新版本更新" />
                )}
              </span>
              <span className="theme-tab-hint">{hint}</span>
            </button>
          ))}
        </nav>

        <div className="theme-manage-sections" ref={sectionsRef}>
          {activeTab === "home" && (
            <OverviewTab
              draft={draft}
              patch={patch}
              handleSave={handleSave}
              showToast={showToast}
              setRatingLabelDraft={setRatingLabelDraft}
              realOverview={realOverview}
              isPriceVisible={isPriceVisible}
              realCostSummary={realCostSummary}
              todayTrafficTotal={todayTrafficTotal}
              todayTrafficHourly={todayTrafficHourly}
              todayTrafficPending={todayTrafficTotal === null && todayTrafficQuery.isPending}
              allNodes={allMeta}
              exchangeRates={premiumRateQuery.data?.rates}
            />
          )}

          {activeTab === "card" && (
            <ServerTab
              draft={draft}
              patch={patch}
              patchBindings={patchBindings}
              patchPingLatencyThreshold={patchPingLatencyThreshold}
              patchPingLatencyColor={patchPingLatencyColor}
              resetPingLatency={resetPingLatency}
              patchPingLossThreshold={patchPingLossThreshold}
              patchPingLossColor={patchPingLossColor}
              resetPingLoss={resetPingLoss}
              patchTrafficSpectrumColor={patchTrafficSpectrumColor}
              applyStatusBarPreset={applyStatusBarPreset}
              resetTrafficSpectrum={resetTrafficSpectrum}
              sortedTasks={sortedTasks}
              filteredTasks={filteredTasks}
              taskSearch={taskSearch}
              setTaskSearch={setTaskSearch}
              canAddMultiPingTask={canAddMultiPingTask}
              addMultiPingTask={addMultiPingTask}
              patchMultiPingTask={patchMultiPingTask}
              removeMultiPingTask={removeMultiPingTask}
              draftMultiPingInvalid={draftMultiPingInvalid}
              tasksLoading={tasksLoading}
              clientsLoading={clientsLoading}
              noTasksYet={noTasksYet}
              noFilteredTaskMatch={noFilteredTaskMatch}
              expandedTaskId={expandedTaskId}
              toggleTaskExpanded={toggleTaskExpanded}
              clientsById={clientsById}
              visibleClients={visibleClients}
              nodeSearch={nodeSearch}
              setNodeSearch={setNodeSearch}
              orderedDraftGroups={orderedDraftGroups}
              moveGroup={moveGroup}
              draftHiddenNodes={draftHiddenNodes}
            />
          )}

          {activeTab === "cost" && (
            <CostTab
              isPriceVisible={isPriceVisible}
              draft={draft}
              patch={patch}
              draftCostRateApiUrlInvalid={draftCostRateApiUrlInvalid}
              premiumSearch={premiumSearch}
              setPremiumSearch={setPremiumSearch}
              clientsLoading={clientsLoading}
              sortedClients={sortedClients}
              filteredPremiumClients={filteredPremiumClients}
              premiumDetailByUuid={premiumDetailByUuid}
              rateLoading={premiumRateQuery.isLoading}
              acquiredAtMax={acquiredAtMax}
              patchPremiumPaid={patchPremiumPaid}
              patchPremiumAcquiredAt={patchPremiumAcquiredAt}
            />
          )}

          {activeTab === "other" && (
            <OtherTab
              draft={draft}
              patch={patch}
              setAppearance={setAppearance}
            />
          )}

          {activeTab === "feedback" && (
            <HelpTab currentVersion={currentVersion} hasUpdate={hasUpdate} />
          )}
        </div>
      </div>
    </div>
  );
}

export default ThemeManage;
