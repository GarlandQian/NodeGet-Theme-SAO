import { describe, expect, it } from "vitest";
import { pingChartStatusMessage, summarizePingRecords } from "@/components/instance/PingChart";
import type { PingRecord } from "@/types/models";
import { HttpRequestError } from "@/services/requestErrors";

function record(
  time: string,
  value: number,
  count: number,
  loss: number,
): PingRecord {
  return { task_id: 1, client: "node-a", time, value, count, loss };
}

describe("summarizePingRecords", () => {
  it("weights aggregate latency and loss by the represented sample counts", () => {
    const summary = summarizePingRecords([
      record("2026-01-01T00:00:00Z", 10, 10, 0),
      record("2026-01-01T00:01:00Z", 100, 2, 50),
      record("2026-01-01T00:02:00Z", -1, 5, 100),
    ]);

    expect(summary).toMatchObject({
      latest: null,
      min: 10,
      max: 100,
      p50: 10,
      total: 17,
      lost: 6,
    });
    expect(summary.avg).toBeCloseTo(200 / 11, 8);
    expect(summary.p99).toBeCloseTo(91, 8);
    expect(summary.loss).toBeCloseTo((6 / 17) * 100, 8);
  });

  it("keeps the latest failed probe distinct from an earlier successful latency", () => {
    const summary = summarizePingRecords([
      record("2026-01-01T00:00:00Z", 10, 1, 0),
      record("2026-01-01T00:01:00Z", -1, 1, 100),
    ]);
    expect(summary.latest).toBeNull();
    expect(summary.avg).toBe(10);
    expect(summary.loss).toBe(50);
  });
});

describe("Ping chart data status", () => {
  it("shows partial results even when the available series covers the full time range", () => {
    expect(pingChartStatusMessage({
      records: [record("2026-01-01T00:00:00Z", 20, 1, 0)],
      quality: "partial",
      message: "部分 Ping 类型无法读取，统计仅包含可读任务",
    }, false, undefined)).toBe("部分 Ping 类型无法读取，统计仅包含可读任务");
  });

  it("distinguishes permission failures from missing data and labels retained samples", () => {
    const cached = { records: [record("2026-01-01T00:00:00Z", 20, 1, 0)] };
    expect(pingChartStatusMessage(cached, true, new HttpRequestError("hidden", 403, "task_query")))
      .toBe("没有权限读取历史数据；显示上次数据");
    expect(pingChartStatusMessage(undefined, true, new HttpRequestError("hidden", 404, "task_query")))
      .toBe("暂无 Ping 数据或尚未配置任务");
  });
});
