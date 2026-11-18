import { LayoutTemplate, Compass } from "lucide-react";
import { InstancePanel } from "@/components/instance/InstancePanel";
import { APPEARANCE_OPTIONS } from "../constants";
import { ToggleRow } from "../components/SettingControls";
import type { ThemeDraft } from "../types";

export function OtherTab({
  draft,
  patch,
  setAppearance,
}: {
  draft: ThemeDraft;
  patch: <K extends keyof ThemeDraft>(key: K, value: ThemeDraft[K]) => void;
  setAppearance: (value: "light" | "dark" | "system") => void;
}) {
  return (
    <>
      <InstancePanel
        kicker="外观"
        title="访客默认外观"
        aside={<LayoutTemplate size={16} />}
      >
        <div className="instance-segmented is-prominent is-even">
          {APPEARANCE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              data-active={draft.defaultAppearance === value ? "true" : "false"}
              aria-pressed={draft.defaultAppearance === value}
              onClick={() => {
                patch("defaultAppearance", value);
                setAppearance(value);
              }}
              className="inline-flex items-center justify-center gap-2"
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </InstancePanel>

      <InstancePanel
        kicker="权限"
        title="页面入口与费用公开"
        aside={<Compass size={16} />}
      >
        <div className="flex flex-col gap-4">
          <div>
            <span className="setting-subhead-title block mb-2">卡片快捷按钮</span>
            <div className="grid gap-3 md:grid-cols-3">
              <ToggleRow
                field="showTrafficPageButton"
                title="流量入口"
                desc="在流量卡片右上角显示小图表按钮，点击直达统计页。"
                checked={draft.showTrafficPageButton}
                onPatch={patch}
              />
              <ToggleRow
                field="showCostSummary"
                title="资产入口"
                desc="资产费用已公开时，在资产卡片显示统计页入口。"
                checked={draft.showCostSummary}
                onPatch={patch}
              />
              <ToggleRow
                field="showCostSummaryFloatingButton"
                title="悬浮入口"
                desc="在右下角悬浮显示资产入口，未显示资产卡片时生效。"
                checked={draft.showCostSummaryFloatingButton}
                onPatch={patch}
              />
            </div>
          </div>

          <div className="border-t border-(--border-subtle) pt-3">
            <span className="setting-subhead-title block mb-2">页面可见性</span>
            <div className="grid gap-3 md:grid-cols-2">
              <ToggleRow
                field="showTrafficPageForGuests"
                title="公开流量明细"
                desc="允许普通访客点击进入流量统计页面，查看各节点用量。"
                checked={draft.showTrafficPageForGuests}
                onPatch={patch}
              />
              <div className="surface-inset rounded-xl px-4 py-3 text-[13px]">
                <strong>资产费用：{draft.showPriceForGuests ? "站点已公开" : "站点未公开"}</strong>
                <p className="mt-1 text-(--text-secondary)">站长可在 NodeGet 主题配置中设置费用公开范围。截图防窥仅隐藏当前屏幕上的费用。</p>
              </div>
            </div>
          </div>
        </div>
      </InstancePanel>
    </>
  );
}
