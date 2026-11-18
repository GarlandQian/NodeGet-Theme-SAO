import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Github,
  HelpCircle,
  MessageSquare,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { InstancePanel } from "@/components/instance/InstancePanel";
import { PROJECT_REPOS } from "../constants";

type FaqCategory = "all" | "network" | "asset" | "visual" | "general";

interface FaqItem {
  id: string;
  category: "network" | "asset" | "visual" | "general";
  q: string;
  keywords: string[];
  answer: string;
}

const FAQ_CATEGORIES: Array<{ id: FaqCategory; label: string }> = [
  { id: "all", label: "全部问题" },
  { id: "network", label: "网络测速" },
  { id: "asset", label: "资产财务" },
  { id: "visual", label: "微图与大盘" },
  { id: "general", label: "开源与反馈" },
];

const faqItems: FaqItem[] = [
  {
    id: "nodeget-authorization", category: "general",
    q: "安装主题后为什么提示尚未添加主控授权？",
    keywords: ["授权", "Token", "主控", "安装", "空白"],
    answer: "在 NodeGet 后台打开已安装的 SAO 主题，进入「Token 授权」，添加主控地址和公开只读 Token 并点「确定」。回到主题后点击「已保存授权，重新读取」。独立部署时，在 config.json 的 site_tokens 中填写对应连接。",
  },
  {
    id: "nodeget-preferences", category: "general",
    q: "怎样把本机保存的设置应用到全站？",
    keywords: ["导入", "导出", "保存", "同步", "配置", "恢复"],
    answer: "在设置页导出 user_preferences，替换 NodeGet 主题配置或静态部署 config.json 中的同名字段，并保留站点原有的 site_tokens。已有本地覆盖的浏览器可点「恢复站点设置」重新采用站点偏好。",
  },
  {
    id: "nodeget-native-ping", category: "network",
    q: "为什么有节点却看不到 Ping 线路？",
    keywords: ["Ping", "TCPing", "自动发现", "任务", "无权限"],
    answer: "主题从每个主控的 Ping 和 TCPing 执行记录发现任务。请确认该节点的任务运行过，并为主题授权读取任务记录。首页可以自动选择可用任务，也可在「服务器」中指定线路。",
  },
  {
    id: "carrier-loss", category: "network",
    q: "三网丢包如何识别运营商？",
    keywords: ["三网丢包", "电信", "联通", "移动", "CT", "CU", "CM", "多线"],
    answer: "在多线模式下，主题按任务名称识别电信、联通、移动，也支持独立缩写 CT、CU、CM 和英文运营商名称。每个运营商显示参评节点中已识别线路的平均丢包率。缺少对应记录时显示缺失状态。",
  },
  {
    id: "yesterday-best-line-boundaries", category: "network",
    q: "哪些节点可以参加线路稳定性排名？",
    keywords: ["稳定评分", "三网", "缺考", "榜单", "单线", "单运营商"],
    answer: "榜单读取选中节点近 24 小时的 NodeGet 实测记录。三网综合要求三个运营商都有记录，缺线路的节点可在榜单中查看缺项。单运营商模式统计对应线路，全量模式纳入全部任务。只有有效延迟样本的节点才能计算稳定性。",
  },
  {
    id: "yesterday-best-score-algorithm", category: "network",
    q: "线路稳定分如何计算？",
    keywords: ["稳定评分", "丢包", "抖动", "P99", "尖峰", "同分"],
    answer: "每个节点从 100 分起算，根据丢包、时延抖动与延迟尖峰扣分。丢包统计纳入超时记录，延迟统计使用有效响应。得分相同时依次比较抖动、尖峰比、平均延迟和节点顺序。",
  },
  {
    id: "today-traffic-histogram-scale", category: "visual",
    q: "今日流量微图的七根柱分别代表什么？",
    keywords: ["流量快照", "直方图", "微图", "柱状图", "小时"],
    answer: "每根柱对应最近七个整点小时段中的一个，最右侧是当前小时。柱高按这些小时的用量比例绘制。NodeGet 主控需要有可读取的流量快照，当前小时显示已经累计的流量。",
  },
  {
    id: "asset-calculating", category: "asset",
    q: "资产页面显示费用未公开、未配置或计算中怎么办？",
    keywords: ["公开", "费用", "未配置", "计算中", "汇率", "缓存", "币种"],
    answer: "站长可在部署配置的 user_preferences.theme_settings 中开启 showPriceForGuests，并授予主题读取节点费用字段的权限。资产明细会列出缺少的费用数据。首次换算需要读取汇率，可以在「资产」设置中更换汇率源。",
  },
  {
    id: "asset-value-vs-remaining", category: "asset",
    q: "资产总值和剩余价值有什么区别？",
    keywords: ["资产", "总值", "剩余价值", "溢价"],
    answer: "资产总值按已计入节点的一期账单折算，剩余价值按到期日和账期估算。打开资产明细可以逐台核对。汇总支持人民币、美元和欧元，币种和汇率源可在「资产」中设置。",
  },
  {
    id: "cost-float-button", category: "asset",
    q: "为何开启悬浮入口后仍然看不到资产按钮？",
    keywords: ["悬浮", "入口", "资产", "防窥"],
    answer: "先确认站点已公开费用，并关闭截图防窥。首页已显示资产总值卡时，可从卡片进入资产页。",
  },
  {
    id: "mini-card-slot", category: "visual",
    q: "迷你卡片和列表使用哪条线路的延迟？",
    keywords: ["迷你", "卡片", "列表", "槽位", "延迟"],
    answer: "在「服务器」中可查看节点的首页 Ping 线路配置。多线展示遵循已选线路的顺序。未指定任务时，主题从当前节点可读取的真实记录中选择可用任务。",
  },
  {
    id: "matrix-curve-toggle", category: "visual",
    q: "怎样在曲线与方格矩阵之间切换？",
    keywords: ["矩阵", "曲线", "首页", "点阵"],
    answer: "打开「总览」设置，切换集群展示样式。选择矩阵后还可以配置点阵图案和配色。",
  },
  {
    id: "sparkline-dynamic", category: "visual",
    q: "怎样切换指标卡片的动态微图？",
    keywords: ["微图", "动态", "静态", "指标", "大盘"],
    answer: "在「总览」的指标卡池中选择卡片，并切换微图显示。动态流量柱使用主控的小时流量数据，三网丢包使用已识别任务的实测统计。",
  },
  {
    id: "theme-license", category: "general",
    q: "使用或再发布主题时需要保留什么？",
    keywords: ["开源", "修改", "版权", "协议", "MIT"],
    answer: "本项目使用 MIT 许可证。再发布时请保留原作者版权声明和许可证文本，仓库根目录的 LICENSE 包含完整条款。",
  },
  {
    id: "feedback-tips", category: "general",
    q: "反馈问题时需要哪些信息？",
    keywords: ["反馈", "Issue", "环境", "复现", "截图"],
    answer: "请附上 NodeGet 和主题版本、浏览器、复现步骤及脱敏截图。反馈授权问题时，可以说明缺少哪类读取权限，请勿附上 Token 或包含它的 config.json。",
  },
];

export function HelpTab({
  currentVersion,
  hasUpdate = false,
}: {
  currentVersion: string;
  hasUpdate?: boolean;
}) {
  const [searchParams] = useSearchParams();
  const faqParam = searchParams.get("faq");

  const [activeCategory, setActiveCategory] = useState<FaqCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFaqId, setExpandedFaqId] = useState<string | null>(null);
  const [showAllFaqs, setShowAllFaqs] = useState(false);

  useEffect(() => {
    if (!faqParam) return;
    const targetFaq = faqItems.find((item) => item.id === faqParam);
    if (targetFaq) {
      setActiveCategory(targetFaq.category);
      setShowAllFaqs(true);
      setExpandedFaqId(faqParam);
      const scroll = () => {
        const element = document.getElementById(`faq-${faqParam}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      };
      const t1 = setTimeout(scroll, 100);
      const t2 = setTimeout(scroll, 350);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [faqParam]);

  const filteredFaqs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return faqItems.filter((item) => {
      const matchCat = activeCategory === "all" || item.category === activeCategory;
      if (!matchCat) return false;
      if (!q) return true;
      const inTitle = item.q.toLowerCase().includes(q);
      const inKeywords = item.keywords.some((k) => k.toLowerCase().includes(q));
      return inTitle || inKeywords;
    });
  }, [activeCategory, searchQuery]);

  const MAX_DEFAULT_FAQ_COUNT = 5;
  const isSearchActive = Boolean(searchQuery.trim());
  const hasMoreFaqs = !isSearchActive && filteredFaqs.length > MAX_DEFAULT_FAQ_COUNT;
  const visibleFaqs = hasMoreFaqs && !showAllFaqs
    ? filteredFaqs.slice(0, MAX_DEFAULT_FAQ_COUNT)
    : filteredFaqs;

  const toggleFaq = (id: string) => {
    setExpandedFaqId((prev) => (prev === id ? null : id));
  };

  return (
    <>
      {/* 面板 1：常见问题速查 (FAQ) - 方案 A 交互升级 */}
      <InstancePanel
        kicker="帮助"
        title="常见问题速查 (FAQ)"
        aside={<HelpCircle size={16} />}
      >
        <div className="flex flex-col gap-3">
          {/* 1. 搜索过滤栏与计数 */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-1">
            {/* 搜索输入框 */}
            <div className="relative flex-1 min-w-0">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-muted) pointer-events-none"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索 FAQ，如：三网丢包、汇率、微图、大盘..."
                className="w-full h-8 pl-8.5 pr-8 rounded-xl border border-(--hairline) bg-[color-mix(in_srgb,var(--bg-card)_60%,transparent)] text-xs text-(--text-primary) placeholder:text-(--text-muted) focus:outline-hidden focus:border-(--accent-500)/60 focus:ring-1 focus:ring-(--accent-500)/30 transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-(--text-muted) hover:text-(--text-primary) p-0.5 rounded cursor-pointer"
                  title="清空搜索"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* 条目统计 */}
            <div className="text-[11px] text-(--text-muted) shrink-0 flex items-center gap-1.5 px-1 sm:px-0">
              <span>共匹配</span>
              <span className="font-mono font-bold text-(--text-primary)">
                {filteredFaqs.length}
              </span>
              <span>/ {faqItems.length} 条</span>
            </div>
          </div>

          {/* 2. 分类过滤胶囊 Tag 栏 */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {FAQ_CATEGORIES.map(({ id, label }) => {
              const active = activeCategory === id;
              const count = id === "all" ? faqItems.length : faqItems.filter((f) => f.category === id).length;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setActiveCategory(id);
                    setExpandedFaqId(null);
                    setShowAllFaqs(false);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all shrink-0 cursor-pointer ${
                    active
                      ? "bg-(--accent-500) text-white shadow-xs font-semibold"
                      : "bg-[color-mix(in_srgb,var(--bg-card)_60%,transparent)] border border-(--hairline) text-(--text-muted) hover:text-(--text-primary) hover:border-(--accent-500)/30"
                  }`}
                >
                  <span>{label}</span>
                  <span className={`text-[10px] font-mono px-1 rounded-full ${
                    active ? "bg-white/25 text-white" : "bg-(--hairline) text-(--text-muted)"
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 3. FAQ 列表（支持单开互斥手风琴） */}
          <div className="space-y-2 mt-1">
            {filteredFaqs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center rounded-2xl border border-dashed border-(--hairline) bg-[color-mix(in_srgb,var(--bg-card)_30%,transparent)]">
                <HelpCircle size={24} className="text-(--text-muted) opacity-40 mb-2" />
                <p className="text-xs font-medium text-(--text-secondary)">没有找到匹配的常见问题</p>
                <p className="text-[11px] text-(--text-muted) mt-1">请尝试更换搜索关键词或切换分类</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setActiveCategory("all");
                  }}
                  className="mt-3 text-xs text-(--accent-500) hover:underline font-medium cursor-pointer"
                >
                  重置筛选条件
                </button>
              </div>
            ) : (
              visibleFaqs.map((item) => {
                const isExpanded = expandedFaqId === item.id;
                return (
                  <div
                    key={item.id}
                    id={`faq-${item.id}`}
                    className={`rounded-2xl border border-(--hairline) bg-[color-mix(in_srgb,var(--bg-card)_55%,transparent)] transition-all shadow-xs ${
                      isExpanded ? "ring-1 ring-(--accent-500)/30 bg-[color-mix(in_srgb,var(--bg-card)_75%,transparent)]" : "hover:border-(--accent-500)/40"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleFaq(item.id)}
                      className="w-full flex items-center justify-between gap-3 p-3.5 sm:p-4 text-left cursor-pointer select-none"
                      aria-expanded={isExpanded}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border border-(--hairline) bg-(--bg-card) text-(--text-muted) shrink-0">
                          {FAQ_CATEGORIES.find(category => category.id === item.category)?.label}
                        </span>
                        <span className="font-medium text-xs text-(--text-primary) leading-snug">
                          {item.q}
                        </span>
                      </div>
                      <ChevronDown
                        size={14}
                        className={`text-(--text-muted) transition-transform duration-200 shrink-0 ${
                          isExpanded ? "rotate-180 text-(--accent-500)" : ""
                        }`}
                      />
                    </button>

                    {isExpanded && (
                      <div className="px-3.5 pb-3.5 sm:px-4 sm:pb-4 pt-0 text-xs text-(--text-secondary) leading-relaxed animate-fade-in">
                        {item.answer}
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* 4. 超过 5 条时的平滑折叠展开控制按钮 */}
            {hasMoreFaqs && (
              <div className="pt-1 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowAllFaqs((prev) => !prev)}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border border-(--hairline) bg-[color-mix(in_srgb,var(--bg-card)_70%,transparent)] text-(--text-secondary) hover:text-(--accent-500) hover:border-(--accent-500)/40 hover:bg-[color-mix(in_srgb,var(--bg-card)_90%,transparent)] shadow-xs transition-all cursor-pointer group"
                >
                  <span>
                    {showAllFaqs ? "收起部分常见问题" : "查看更多常见问题"}
                  </span>
                  <ChevronDown
                    size={13}
                    className={`text-(--text-muted) group-hover:text-(--accent-500) transition-transform duration-200 ${
                      showAllFaqs ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </div>
            )}
          </div>
        </div>
      </InstancePanel>

      {/* NodeGet 主题反馈 */}
              <InstancePanel
                kicker="反馈"
                title="项目反馈与代码仓库"
                aside={<MessageSquare size={16} />}
              >
                <div className="space-y-4">
                  <p className="text-xs text-(--text-muted) leading-relaxed">
                    主题界面、数据展示和本机偏好设置的问题，请在 NodeGet SAO 仓库反馈。
                  </p>

                  <div className="grid gap-3">
                    {PROJECT_REPOS.map((proj) => (
                      <div
                        key={proj.id}
                        className={`rounded-2xl border p-3.5 sm:p-4 transition-all shadow-xs flex flex-col justify-between ${
                          proj.isCurrent
                            ? "border-(--accent-500)/40 bg-[color-mix(in_srgb,var(--accent-500)_4%,var(--bg-card))] ring-1 ring-(--accent-500)/20"
                            : "border-(--hairline) bg-[color-mix(in_srgb,var(--bg-card)_55%,transparent)]"
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-1.5 pb-2.5 border-b border-(--hairline)">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-xs sm:text-sm font-semibold text-(--text-primary) truncate">
                                {proj.name}
                              </span>
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-(--hairline) bg-(--bg-card) text-(--text-secondary) shrink-0">
                                {proj.tag}
                              </span>
                            </div>
                            {proj.isCurrent && (
                              hasUpdate ? (
                                <span
                                  className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30 shrink-0"
                                  title="检测到新版本发布，可前往下方对应仓库或首页底部查看更新"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                  检测到更新
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-(--accent-500)/15 text-(--accent-500) border border-(--accent-500)/30 shrink-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-(--accent-500) animate-pulse" />
                                  当前运行
                                </span>
                              )
                            )}
                          </div>

                          <div className="text-[11px] font-mono text-(--text-muted) truncate">
                            {proj.repo}
                          </div>

                          <p className="text-xs text-(--text-secondary) leading-relaxed min-h-[2.5em] line-clamp-2">
                            {proj.desc}
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-3 mt-1 border-t border-(--hairline)">
                          <a
                            href={proj.newIssueUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`repo-action-btn ${proj.isCurrent ? "is-primary" : "is-secondary"}`}
                          >
                            <span>提交反馈</span>
                            <ExternalLink size={12} strokeWidth={2.2} />
                          </a>

                          <a
                            href={proj.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="repo-action-btn is-secondary"
                          >
                            <Github size={12} />
                            <span>GitHub</span>
                            <ExternalLink size={12} />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </InstancePanel>

              {/* 面板 3：反馈范围与提单指引 */}
              <InstancePanel
                kicker="指引"
                title="反馈范围与提单指引"
                aside={<AlertCircle size={16} />}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div className="rounded-2xl border border-(--hairline) bg-[color-mix(in_srgb,var(--bg-card)_55%,transparent)] p-4 sm:p-5 shadow-xs">
                    <div className="flex items-center gap-2 text-xs font-semibold text-(--text-primary) pb-2.5 mb-3 border-b border-(--hairline)">
                      <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
                      <span>建议在本仓库反馈的问题</span>
                    </div>
                    <ul className="text-xs text-(--text-secondary) space-y-2 leading-relaxed list-disc list-inside">
                      <li>首页与内页的功能BUG反馈</li>
                      <li>具有普适性的主题功能需求建议</li>
                      <li>设计呈现与色彩方案建议与异常反馈</li>
                      <li>手机端、平板等不同分辨率下的响应式排版优化建议</li>
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-(--hairline) bg-[color-mix(in_srgb,var(--bg-card)_55%,transparent)] p-4 sm:p-5 shadow-xs">
                    <div className="flex items-center gap-2 text-xs font-semibold text-(--text-primary) pb-2.5 mb-3 border-b border-(--hairline)">
                      <AlertCircle size={15} className="text-amber-500 shrink-0" />
                      <span>适合向 NodeGet 项目反馈的问题</span>
                    </div>
                    <ul className="text-xs text-(--text-secondary) space-y-2 leading-relaxed list-disc list-inside">
                      <li>探针客户端（Agent）掉线、离线重连或节点在线状态误报</li>
                      <li>探针底层系统指标采集不准（如 CPU/内存/磁盘占用率异常）</li>
                      <li>服务端 Docker 容器部署、反向代理或 WebSocket 连接中断</li>
                      <li>原系统基础权限管理与后端数据库存储错误</li>
                    </ul>
                  </div>
                </div>
              </InstancePanel>

              {/* 面板 4：关于与致谢 */}
              <InstancePanel
                kicker="关于"
                title="关于 SAO 主题"
                aside={<Sparkles size={16} />}
              >
                <div className="rounded-2xl border border-(--hairline) bg-[color-mix(in_srgb,var(--bg-card)_55%,transparent)] p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-(--text-primary)">
                        NodeGet SAO Theme
                      </span>
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border border-(--hairline) bg-(--bg-card) text-(--accent-500)">
                        {currentVersion}
                      </span>
                    </div>
                    <p className="text-xs text-(--text-muted)">
                      NodeGet 原生监控主题。感谢 WAOR 和 SAO 主题社区贡献者。
                    </p>
                  </div>
                  <a
                    href="https://github.com/GarlandQian/NodeGet-Theme-SAO"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-(--hairline) bg-(--bg-card) text-(--text-primary) hover:border-(--accent-500) hover:text-(--accent-500) shadow-xs transition-colors shrink-0 cursor-pointer"
                  >
                    <Star size={13} className="text-amber-400 fill-amber-400" />
                    <span>在 GitHub 上 Star 支持</span>
                  </a>
                </div>
              </InstancePanel>
    </>
  );
}
