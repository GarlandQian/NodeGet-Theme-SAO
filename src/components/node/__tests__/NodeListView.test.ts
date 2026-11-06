import { describe, expect, it } from "vitest";
import {
  formatListPingStatus,
  resolveListPingState,
} from "@/components/node/NodeListView";
import { pingEmptyLabels } from "@/components/node/nodeCardShared";

describe("node list ping status", () => {
  it("distinguishes an unconfigured node from an assigned request", () => {
    expect(resolveListPingState(undefined, false, false)).toBe("unconfigured");
    expect(resolveListPingState("pending", true, true)).toBe("pending");
    expect(resolveListPingState(undefined, true, false)).toBe("pending");
  });

  it("shows loading text when an assigned task has no value yet", () => {
    expect(formatListPingStatus(null, "pending")).toEqual({
      visibleText: "加载中",
      title: "正在加载首页 Ping",
      ariaText: "首页 Ping 加载中",
    });
  });

  it("keeps a stale value visible but announces a failed refresh", () => {
    expect(formatListPingStatus(42.4, "error")).toEqual({
      visibleText: "42",
      title: "首页 Ping 刷新失败，显示上次数据",
      ariaText: "42 毫秒，首页 Ping 刷新失败，显示上次数据",
    });
  });

  it("shows a failed request when it has no previous value", () => {
    expect(formatListPingStatus(null, "error")).toEqual({
      visibleText: "加载失败",
      title: "首页 Ping 加载失败",
      ariaText: "首页 Ping 加载失败",
    });
  });

  it("keeps automatically assigned ping in the normal display state", () => {
    expect(resolveListPingState(undefined, false, true)).toBe("ready");
    expect(formatListPingStatus(null, "ready").visibleText).toBe("无样本");
  });

  it("distinguishes the latest timeout from missing samples", () => {
    expect(formatListPingStatus(null, "ready", undefined, true).visibleText).toBe("超时");
    expect(pingEmptyLabels(true, false, false, undefined, true).text).toBe("超时");
    expect(pingEmptyLabels(true).text).toBe("无样本");
  });

  it("shows permission and missing-data reasons consistently across list and cards", () => {
    const forbidden = { status: "forbidden" as const, message: "没有权限读取 Ping 数据" };
    const unavailable = { status: "unavailable" as const, message: "暂无 Ping 数据或尚未配置任务" };
    expect(formatListPingStatus(null, "error", forbidden).visibleText).toBe("无权限");
    expect(formatListPingStatus(null, "error", unavailable).visibleText).toBe("暂无数据");
    expect(pingEmptyLabels(true, false, true, forbidden)).toEqual({ title: forbidden.message, text: "无权限" });
    expect(pingEmptyLabels(true, false, true, unavailable)).toEqual({ title: unavailable.message, text: "暂无数据" });
  });

  it("preserves partial values while describing incomplete statistics", () => {
    const partial = { status: "partial" as const, message: "部分 Ping 任务无法读取，统计不完整" };
    expect(formatListPingStatus(42, "ready", partial)).toEqual({
      visibleText: "42", title: partial.message, ariaText: `42 毫秒，${partial.message}`,
    });
  });
});
