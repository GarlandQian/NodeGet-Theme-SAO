import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OverviewStatCard } from "@/components/node/OverviewStatCard";

describe("overview missing totals", () => {
  it.each(["ram", "disk", "swap", "nodes"] as const)("does not show demo percentages when %s has no denominator", (cardId) => {
    const html = renderToStaticMarkup(<OverviewStatCard cardId={cardId} overview={{
      totalNodes: 0, onlineNodes: 0, offlineNodes: 0,
      totalRamUsed: 0, totalRamTotal: 0,
      totalDiskUsed: 0, totalDiskTotal: 0,
      totalSwapUsed: 0, totalSwapTotal: 0,
    }} />);
    expect(html).toContain("—");
    for (const percentage of ["59.2", "32.3", "31.8", "83.3"]) expect(html).not.toContain(percentage);
  });

  it("distinguishes a measured zero from an unobserved carrier", () => {
    const html = renderToStaticMarkup(<OverviewStatCard cardId="loss" overview={{ carrierLoss: {
      ct: { count: 1, loss: 0 }, cu: { count: 0, loss: null }, cm: { count: 0, loss: null },
      avgLoss: 0, peakLoss: 0, hasAnyData: true, isMultiPingMode: true,
    } }} />);
    expect(html).toContain("CT 0.0%");
    expect(html).toContain("CU —");
    expect(html).not.toContain("联通: 0");
    expect(html.match(/class="mao-trigram-fill"/g)).toHaveLength(1);
  });

  it("shows yuan when the requested currency has no rate", () => {
    const html = renderToStaticMarkup(<OverviewStatCard cardId="asset" costCurrency="EUR"
      exchangeRates={{ CNY: 1, USD: 0.14 }} costSummary={{ remainingCny: 80, totalOriginalPriceCny: 100 }} />);
    expect(html).toContain("¥100");
    expect(html).not.toContain("€");
  });

  it("keeps real zero usage distinct from missing capacity", () => {
    const html = renderToStaticMarkup(<OverviewStatCard cardId="ram" overview={{ totalRamUsed: 0, totalRamTotal: 1024 }} />);
    expect(html).toContain("0.0");
    expect(html).not.toContain("—");
  });
});
