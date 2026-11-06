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

  it("keeps real zero usage distinct from missing capacity", () => {
    const html = renderToStaticMarkup(<OverviewStatCard cardId="ram" overview={{ totalRamUsed: 0, totalRamTotal: 1024 }} />);
    expect(html).toContain("0.0");
    expect(html).not.toContain("—");
  });
});
