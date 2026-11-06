import { useEffect, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useNodeMeta, useNodeMetrics } from "@/hooks/useNode";
import { useMinuteClock } from "@/hooks/useClock";
import { useTodayTrafficStats } from "@/hooks/useTodayTrafficStats";
import { InstanceSwitcher } from "./InstanceSwitcher";
import {
  formatTodayPeakValue,
  formatTodayTrafficValue,
} from "./instanceTodayTrafficFormat";
import {
  formatBytes,
  formatUptimeDays,
} from "@/utils/format";
import { resolveTrafficUsage } from "@/utils/traffic";
import { InstancePanel } from "./InstancePanel";

// Intl.DateTimeFormat 构造开销大，复用一个实例，别每次 metrics 更新都重建
const TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function InstanceDetails({
  uuid,
  onNodeReady,
}: {
  uuid: string;
  onNodeReady?: () => (() => void) | void;
}) {
  const now = useMinuteClock();
  const meta = useNodeMeta(uuid);
  const metrics = useNodeMetrics(uuid);
  const trafficQuery = useTodayTrafficStats([uuid], now, "summary");
  const todayStat = trafficQuery.data?.rows.find((row) => row.uuid === uuid);
  const isReady = Boolean(meta && metrics);

  useEffect(() => {
    if (!isReady) return;
    return onNodeReady?.();
  }, [isReady, onNodeReady, uuid]);

  if (!meta || !metrics) return null;

  const isOnline = metrics.online;
  if (isOnline == null) {
    return <InstancePanel title={meta.name} titleAction={<InstanceSwitcher currentUuid={uuid} />}>
      <p className="py-6 text-[13px] text-(--text-secondary)">{metrics.dataStatus === "forbidden" ? "没有权限读取实时数据" : metrics.dataStatus === "partial" ? "部分实时指标缺失，等待完整上报。" : "实时数据暂不可用，等待有效上报或连接恢复。"}</p>
    </InstancePanel>;
  }
  const uptime = formatUptimeDays(metrics.uptime);
  const hasDirectionalCycle = metrics.cycleUp != null && metrics.cycleDown != null;
  const hasCycle = metrics.cycleUsed != null || hasDirectionalCycle;
  const cycleUp = metrics.cycleUp ?? metrics.trafficUp;
  const cycleDown = metrics.cycleDown ?? metrics.trafficDown;
  // 与首页使用同一周期用量；扩展仅提供总量时不编造上下行拆分。
  const trafficUsage = resolveTrafficUsage(
    meta.traffic_limit_type,
    cycleUp,
    cycleDown,
    meta.traffic_limit,
    metrics.cycleUsed,
  );
  const lastUpdated =
    metrics.updatedAt > 0 ? TIME_FORMATTER.format(metrics.updatedAt) : "—";
  const trimmedName = meta.name?.trim();
  const panelTitle = trimmedName ? `${trimmedName} 信息` : "实例信息";

  return (
    <InstancePanel
      title={panelTitle}
      titleAction={<InstanceSwitcher currentUuid={uuid} />}
      description={
        isOnline ? undefined : "节点当前离线，以下展示最近一次上报的缓存数据。"
      }
    >
      {(meta.static_status === "forbidden" || meta.metadata_status === "forbidden") && <p role="status" className="mb-3 text-[12px] text-(--text-secondary)">部分节点信息无读取权限，当前仅展示可读取的数据。</p>}
      <div className="instance-info-groups">
        <div className="instance-info-group">
          <div className="instance-info-group-title">系统</div>
          <InfoRow label="状态" value={isOnline ? "在线" : "离线"} />
          <InfoRow
            label="CPU"
            value={`${meta.cpu_name || "—"}${meta.cpu_cores > 0 ? ` (x${meta.cpu_cores})` : ""}`}
          />
          <InfoRow label="架构" value={meta.arch || "—"} />
          <InfoRow label="虚拟化" value={meta.virtualization || "—"} />
          <InfoRow label="显卡" value={meta.gpu_name || "—"} />
          <InfoRow label="操作系统" value={meta.os || "—"} />
        </div>

        <div className="instance-info-group">
          <div className="instance-info-group-title">资源</div>
          <InfoRow label="内存" value={`${formatBytes(metrics.ramUsed)} / ${formatBytes(metrics.ramTotal)}`} />
          <InfoRow
            label="Swap"
            value={
              metrics.swapTotal > 0
                ? `${formatBytes(metrics.swapUsed)} / ${formatBytes(metrics.swapTotal)}`
                : "无"
            }
          />
          <InfoRow label="磁盘" value={`${formatBytes(metrics.diskUsed)} / ${formatBytes(metrics.diskTotal)}`} />
          <InfoRow
            label="负载"
            value={`${metrics.load1.toFixed(2)} | ${metrics.load5.toFixed(2)} | ${metrics.load15.toFixed(2)}`}
          />
          <InfoRow
            label="运行时长"
            value={uptime.unit ? `${uptime.value} ${uptime.unit}` : uptime.value}
          />
        </div>

        <div className="instance-info-group">
          <div className="instance-info-group-title">网络</div>
          <InfoRow
            label={isOnline ? "实时网络" : "缓存网络"}
            value={`↑ ${formatBytes(metrics.netUp)}/s · ↓ ${formatBytes(metrics.netDown)}/s`}
          />
          <InfoRow label={isOnline ? "最近更新" : "最后上报"} value={lastUpdated} />
          <InfoRow
            label="今日流量"
            value={
              <span className="instance-info-inline-value">
                <span>
                  {formatTodayTrafficValue(
                    todayStat,
                    trafficQuery.isPending,
                    trafficQuery.isError,
                  )}
                </span>
                <button
                  type="button"
                  className={`instance-info-refresh${trafficQuery.isFetching ? " is-spinning" : ""}`}
                  onClick={() => void trafficQuery.refetch()}
                  disabled={trafficQuery.isFetching}
                  aria-busy={trafficQuery.isFetching}
                  aria-label="刷新今日流量"
                  title="刷新今日流量"
                >
                  <RefreshCw size={13} strokeWidth={2.2} />
                </button>
              </span>
            }
          />
          <InfoRow
            label="峰值速度"
            value={formatTodayPeakValue(todayStat, trafficQuery.isPending)}
          />
          <div className="instance-info-item is-stack">
            <span className="instance-info-label">{hasCycle ? "周期流量" : "总流量"}</span>
            <div className="instance-info-traffic">
              <span className="instance-info-value">{hasCycle && !hasDirectionalCycle
                ? `合计 ${formatBytes(trafficUsage.used)}（上行＋下行）`
                : `↑ ${formatBytes(cycleUp)} · ↓ ${formatBytes(cycleDown)}`}</span>
              <div
                className={`instance-progress-track${trafficUsage.unlimited ? " is-unlimited" : ""}`}
                aria-hidden
              >
                {!trafficUsage.unlimited && hasCycle && (
                  <span
                    className="instance-progress-fill"
                    style={{ width: `${trafficUsage.fraction * 100}%` }}
                  />
                )}
              </div>
              <span className="instance-info-note">
                {trafficUsage.unlimited
                  ? `${formatBytes(trafficUsage.used)} / ∞`
                  : hasCycle ? `${formatBytes(trafficUsage.used)} / ${formatBytes(trafficUsage.limit)}` : `${metrics.cycleReason || "暂无周期数据"} / ${formatBytes(trafficUsage.limit)}`}
              </span>
              {metrics.cyclePartial && <span className="instance-info-note">{metrics.cycleReason || "周期数据未覆盖完整时段，实际用量可能更高。"}</span>}
              {hasCycle && (
                <span className="instance-info-note">
                  开机累计：↑ {formatBytes(metrics.trafficUp)} · ↓ {formatBytes(metrics.trafficDown)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </InstancePanel>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="instance-info-item">
      <span className="instance-info-label">{label}</span>
      <div className="instance-info-value">{value}</div>
    </div>
  );
}
