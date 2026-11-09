import { describe, expect, it } from "vitest";
import {
  getTodayTrafficRefreshInterval,
  selectActiveTodayTrafficUuids,
} from "@/hooks/todayTrafficQueryPolicy";
import { throwIfSignalAborted } from "@/hooks/useTodayTrafficStats";

describe("today traffic query policy", () => {
  it("only queries nodes whose popovers are currently active", () => {
    const active = new Set(["node-b", "node-c"]);

    expect(
      selectActiveTodayTrafficUuids(
        ["node-a", "node-b", "node-b", "node-c"],
        active,
      ),
    ).toEqual(["node-b", "node-c"]);
    expect(selectActiveTodayTrafficUuids(["node-a"], new Set())).toEqual([]);
  });

  it("keeps successful metric queries refreshing", () => {
    expect(getTodayTrafficRefreshInterval(true, false)).toBe(5 * 60 * 1000);
  });

  it("retries failed queries on a shorter interval without polling an idle query", () => {
    expect(getTodayTrafficRefreshInterval(true, true)).toBe(60 * 1000);
    expect(getTodayTrafficRefreshInterval(false, true)).toBe(60 * 1000);
    expect(getTodayTrafficRefreshInterval(false, false)).toBe(false);
  });

  it("uses the abort flag directly for older Safari without throwIfAborted", () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => throwIfSignalAborted(controller.signal)).toThrowError(
      expect.objectContaining({ name: "AbortError" }),
    );
  });
});
