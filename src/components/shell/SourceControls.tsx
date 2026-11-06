import { useEffect, useState } from "react";
import { getSourceStatuses, subscribeSourceStatuses } from "@/services/api";
import { useSourceSelection, setSelectedSource } from "@/hooks/useSourceSelection";

export function SourceControls() {
  const [sources, setSources] = useState(getSourceStatuses);
  const selected = useSourceSelection();
  useEffect(() => {
    const update = () => setSources(getSourceStatuses());
    const unsubscribe = subscribeSourceStatuses(update);
    update();
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (selected && sources.length > 0 && !sources.some(source => source.id === selected)) {
      setSelectedSource("");
    }
  }, [selected, sources]);

  const failures = sources.filter((source) => source.status === "error");
  const unconfigured = sources.length > 0 && sources.every((source) => source.status === "unconfigured");
  const loading = sources.length === 0 || sources.some((source) => source.status === "loading");
  return (
    <section className="source-controls mb-4 space-y-2" aria-label="主控连接与筛选">
      {sources.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <label htmlFor="source-filter" className="text-(--text-secondary)">主控</label>
          <select
            id="source-filter"
            className="control-button max-w-full px-3 py-2"
            value={sources.some((source) => source.id === selected) ? selected : ""}
            onChange={(event) => setSelectedSource(event.target.value)}
          >
            <option value="">全部主控 · 分别统计</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}{source.status === "error" ? " · 连接异常" : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      {unconfigured ? (
        <div role="status" className="rounded-xl border border-(--border-color) bg-(--surface-1) px-4 py-4 text-[13px] text-(--text-secondary)">
          <p className="font-semibold text-(--text-primary)">主题已加载，尚未添加主控授权</p>
          <p className="mt-2">在 NodeGet 后台安装的主题，请打开“主题管理 → 当前主题 → Token 授权”，添加主控预设或填写公开只读 Token，然后点击“确定”。</p>
          <p className="mt-2 text-[12px] text-(--text-tertiary)">独立静态部署请填写 config.json 的 site_tokens。安装 ZIP 或只保存“用户配置”不会自动添加主控授权。</p>
          <button type="button" className="control-button mt-3 px-3 py-2" onClick={() => window.location.reload()}>已保存授权，重新读取</button>
        </div>
      ) : failures.length > 0 ? (
        <div role="status" className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-[13px] text-(--text-secondary)">
          <p>{failures.length === sources.length ? "当前主控数据无法读取，请检查下方连接或授权提示。" : "部分监控数据不可用，汇总可能不完整。其他主控继续更新。"}</p>
          {failures.map((source) => <p key={source.id}>{source.name}：{source.error || "连接失败，正在重试"}</p>)}
        </div>
      ) : loading ? (
        <p role="status" className="text-[12px] text-(--text-tertiary)">正在连接主控…</p>
      ) : null}
    </section>
  );
}
