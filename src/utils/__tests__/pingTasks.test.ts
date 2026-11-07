import { describe, expect, it } from "vitest";
import {
  assignHomepageMultiPingTask,
  assignHomepagePingTaskClients,
  HOMEPAGE_MULTI_PING_MIN_COUNT,
  isHomepageMultiPingConfigured,
  normalizeHomepageMultiPingTaskIds,
  invertHomepagePingTaskBindings,
  hasHomepagePingTaskBinding,
  normalizeHomepagePingTaskBindings,
  resolveHomepagePingSelections,
  resolveHomepagePingTaskIdsByClient,
} from "@/utils/pingTasks";

describe("homepage ping task bindings", () => {
  it("moves all selected nodes between single lines without clearing the previous line first", () => {
    const nodes = ["node-a", "node-b", "node-c"];
    const first = assignHomepagePingTaskClients({}, 1, nodes);
    const second = assignHomepagePingTaskClients(first, 2, nodes);
    const third = assignHomepagePingTaskClients(second, 3, nodes);
    expect(first).toEqual({ "1": nodes });
    expect(second).toEqual({ "2": nodes });
    expect(third).toEqual({ "3": nodes });
    expect(assignHomepagePingTaskClients(third, 1, nodes)).toEqual(first);
  });

  it("moves only search results and retains existing selections outside that result", () => {
    const bindings = { "1": ["node-a", "node-b"], "2": ["node-c"], "3": ["node-d"] };
    expect(assignHomepagePingTaskClients(bindings, 2, ["node-b", "node-b"])).toEqual({
      "1": ["node-a"], "2": ["node-b", "node-c"], "3": ["node-d"],
    });
    expect(bindings).toEqual({ "1": ["node-a", "node-b"], "2": ["node-c"], "3": ["node-d"] });
    expect(assignHomepagePingTaskClients(bindings, 2, [])).toEqual(bindings);
  });

  it("uses the same exclusive assignment for individual selection and deselection", () => {
    const moved = assignHomepagePingTaskClients({ "1": ["node-a", "node-b"] }, 2, ["node-a"]);
    expect(moved).toEqual({ "1": ["node-b"], "2": ["node-a"] });
    expect(assignHomepagePingTaskClients(moved, 2, ["node-a"], false)).toEqual({ "1": ["node-b"] });
  });

  it("keeps nodes with the same native UUID on different controllers separate", () => {
    const bindings = { "1": ["primary~node-a", "backup~node-a"] };
    expect(assignHomepagePingTaskClients(bindings, 2, ["primary~node-a"])).toEqual({
      "1": ["backup~node-a"], "2": ["primary~node-a"],
    });
  });

  it("accepts only positive decimal safe integers", () => {
    expect(
      normalizeHomepagePingTaskBindings({
        "1e3": ["exponent"],
        "1.5": ["fraction"],
        "0x10": ["hex"],
        "9007199254740992": ["unsafe"],
        "42": ["valid"],
      }),
    ).toEqual({ "42": ["valid"] });
  });

  it("merges IDs that normalize to the same decimal integer", () => {
    expect(
      normalizeHomepagePingTaskBindings({
        "01": ["node-a", "node-b"],
        "1": ["node-b", "node-c"],
      }),
    ).toEqual({ "1": ["node-b", "node-c", "node-a"] });
  });

  it("inverts normalized bindings and gives the lowest task ID precedence", () => {
    expect(
      invertHomepagePingTaskBindings({
        "02": ["node-a"],
        "1": ["node-a", "node-b"],
      }),
    ).toEqual(
      new Map([
        ["node-a", 1],
        ["node-b", 1],
      ]),
    );
  });

  it("reuses the inverted binding index for a stable bindings object", () => {
    const bindings = { "8": ["node-a"], "9": ["node-b"] };
    expect(invertHomepagePingTaskBindings(bindings)).toBe(
      invertHomepagePingTaskBindings(bindings),
    );
  });

  it("reports a binding before overview data has loaded", () => {
    const bindings = { "8": ["node-a"], "9": ["node-b"] };
    expect(hasHomepagePingTaskBinding("node-a", bindings)).toBe(true);
    expect(hasHomepagePingTaskBinding("node-c", bindings)).toBe(false);
  });

  it("normalizes the multi-task selection without truncating its display order", () => {
    expect(normalizeHomepageMultiPingTaskIds(["3", 1, 3, 2, 4])).toEqual([3, 1, 2, 4]);
    expect(
      normalizeHomepageMultiPingTaskIds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(HOMEPAGE_MULTI_PING_MIN_COUNT).toBe(1);
  });

  it("checks whether homepage multi-ping is configured", () => {
    expect(isHomepageMultiPingConfigured([])).toBe(false);
    expect(isHomepageMultiPingConfigured([1])).toBe(true);
    expect(isHomepageMultiPingConfigured([1, 2, 3, 4, 5, 6])).toBe(true);
  });

  it("assigns tasks to slots and swaps when selecting an already chosen task", () => {
    expect(assignHomepageMultiPingTask([1, 2, 3], 1, 4)).toEqual([1, 4, 3]);
    expect(assignHomepageMultiPingTask([1, 2, 3], 0, 2)).toEqual([2, 1, 3]);
    expect(assignHomepageMultiPingTask([1, 2, 3], 5, 4)).toEqual([1, 2, 3]);
  });

  it("uses the same three global tasks for every node and otherwise keeps single bindings", () => {
    const bindings = { "8": ["node-a"], "9": ["node-b"] };
    expect(
      resolveHomepagePingTaskIdsByClient(["node-a", "node-b"], bindings, [3, 1, 2]),
    ).toEqual(
      new Map([
        ["node-a", [3, 1, 2]],
        ["node-b", [3, 1, 2]],
      ]),
    );
    expect(resolveHomepagePingTaskIdsByClient(["node-a", "node-b"], bindings)).toEqual(
      new Map([
        ["node-a", [8]],
        ["node-b", [9]],
      ]),
    );
  });

  it("requests either global multi-ping tasks or per-node single bindings, never both", () => {
    const multiSelections = resolveHomepagePingSelections(
      ["node-a", "node-b"],
      { "8": ["node-a"], "9": ["node-b"] },
      [3, 1, 2],
    );

    expect(multiSelections.singleTaskIdsByClient).toEqual(new Map());
    expect(multiSelections.multiTaskIdsByClient).toEqual(
      new Map([
        ["node-a", [3, 1, 2]],
        ["node-b", [3, 1, 2]],
      ]),
    );
    expect(multiSelections.requestedTaskIdsByClient).toBe(
      multiSelections.multiTaskIdsByClient,
    );

    const singleSelections = resolveHomepagePingSelections(
      ["node-a", "node-b"],
      { "8": ["node-a"], "9": ["node-b"] },
    );
    expect(singleSelections.singleTaskIdsByClient).toEqual(
      new Map([
        ["node-a", [8]],
        ["node-b", [9]],
      ]),
    );
    expect(singleSelections.multiTaskIdsByClient).toEqual(new Map());
    expect(singleSelections.requestedTaskIdsByClient).toBe(
      singleSelections.singleTaskIdsByClient,
    );
  });
});
