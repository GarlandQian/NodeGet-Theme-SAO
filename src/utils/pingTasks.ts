export type HomepagePingTaskBindings = Record<string, string[]>;

export const HOMEPAGE_MULTI_PING_MIN_COUNT = 1;

/** 多线路模式的任务选够了没有。首页消费方与设置页的校验共用这一条口径。 */
export function isHomepageMultiPingConfigured(taskIds: readonly number[]): boolean {
  return taskIds.length >= HOMEPAGE_MULTI_PING_MIN_COUNT;
}

/** 判断是否为无名称时的占位兜底文案，如“任务 #1”或“线路 #1” */
export function isFallbackTaskName(name?: string | null): boolean {
  if (!name) return true;
  return /^(任务|线路)\s*#\d+$/i.test(name.trim());
}

const invertedBindingsCache = new WeakMap<HomepagePingTaskBindings, Map<string, number>>();

function parseTaskId(taskId: string) {
  if (!/^\d+$/.test(taskId)) return null;
  const parsed = Number(taskId);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** 保存和读取共用此函数，不截断线路，避免刷新后丢失已选项。 */
export function normalizeHomepageMultiPingTaskIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  const normalized: number[] = [];
  for (const raw of value) {
    const taskId =
      typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0
        ? raw
        : typeof raw === "string"
          ? parseTaskId(raw)
          : null;
    if (taskId == null || normalized.includes(taskId)) continue;
    normalized.push(taskId);
  }
  return normalized;
}

/**
 * 把多线路的第 `slot` 条换成 `taskId`。选的线路已经在别的槽位时两条互换，不会选出两条一样的线路。
 * 槽位越界时原样返回（拷贝）。
 */
export function assignHomepageMultiPingTask(
  taskIds: readonly number[],
  slot: number,
  taskId: number,
): number[] {
  const next = [...taskIds];
  if (!Number.isInteger(slot) || slot < 0 || slot >= next.length) return next;
  const shownAt = next.indexOf(taskId);
  if (shownAt >= 0 && shownAt !== slot) next[shownAt] = next[slot]!;
  next[slot] = taskId;
  return next;
}

export function normalizeHomepagePingTaskBindings(
  value: unknown,
): HomepagePingTaskBindings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: HomepagePingTaskBindings = {};
  for (const [taskId, clients] of Object.entries(value)) {
    const numericTaskId = parseTaskId(taskId);
    if (numericTaskId == null || !Array.isArray(clients)) continue;

    const uniqueClients = Array.from(
      new Set(
        clients
          .map((client) => (typeof client === "string" ? client.trim() : ""))
          .filter(Boolean),
      ),
    );
    if (uniqueClients.length === 0) {
      continue;
    }

    const normalizedTaskId = String(numericTaskId);
    normalized[normalizedTaskId] = Array.from(
      new Set([...(normalized[normalizedTaskId] ?? []), ...uniqueClients]),
    );
  }

  return normalized;
}

/** 单线模式的勾选和全选共用：将指定节点移到此线路，保留其他节点的绑定。 */
export function assignHomepagePingTaskClients(
  bindings: HomepagePingTaskBindings,
  taskId: number,
  clientUuids: readonly string[],
  checked = true,
): HomepagePingTaskBindings {
  const next = normalizeHomepagePingTaskBindings(bindings);
  const selected = new Set(clientUuids.map((uuid) => uuid.trim()).filter(Boolean));
  if (parseTaskId(String(taskId)) == null || selected.size === 0) return next;

  for (const [currentTaskId, clients] of Object.entries(next)) {
    const remaining = clients.filter((uuid) => !selected.has(uuid));
    if (remaining.length > 0) next[currentTaskId] = remaining;
    else delete next[currentTaskId];
  }

  if (checked) {
    const taskKey = String(taskId);
    next[taskKey] = [...(next[taskKey] ?? []), ...selected].sort((left, right) =>
      left.localeCompare(right),
    );
  }
  return next;
}

export function invertHomepagePingTaskBindings(
  bindings: HomepagePingTaskBindings,
): Map<string, number> {
  const cached = invertedBindingsCache.get(bindings);
  if (cached) return cached;

  const selectedTaskByClient = new Map<string, number>();
  const entries = Object.entries(normalizeHomepagePingTaskBindings(bindings)).sort(
    ([left], [right]) => Number(left) - Number(right),
  );

  for (const [taskId, clients] of entries) {
    const numericTaskId = parseTaskId(taskId);
    if (numericTaskId == null) continue;
    for (const client of clients) {
      if (!selectedTaskByClient.has(client)) {
        selectedTaskByClient.set(client, numericTaskId);
      }
    }
  }

  invertedBindingsCache.set(bindings, selectedTaskByClient);
  return selectedTaskByClient;
}

export function hasHomepagePingTaskBinding(
  clientUuid: string,
  bindings: HomepagePingTaskBindings,
): boolean {
  return Boolean(clientUuid) && invertHomepagePingTaskBindings(bindings).has(clientUuid);
}

export function resolveHomepagePingTaskIdsByClient(
  clientUuids: string[],
  bindings: HomepagePingTaskBindings,
  multiTaskIds: number[] = [],
): Map<string, number[]> {
  const selectedTaskIds = normalizeHomepageMultiPingTaskIds(multiTaskIds);
  const selectedTaskIdsByClient = new Map<string, number[]>();

  if (isHomepageMultiPingConfigured(selectedTaskIds)) {
    for (const uuid of clientUuids) {
      if (uuid) selectedTaskIdsByClient.set(uuid, selectedTaskIds);
    }
    return selectedTaskIdsByClient;
  }

  const singleTaskByClient = invertHomepagePingTaskBindings(bindings);
  for (const uuid of clientUuids) {
    const taskId = singleTaskByClient.get(uuid);
    if (taskId != null) selectedTaskIdsByClient.set(uuid, [taskId]);
  }
  return selectedTaskIdsByClient;
}

export function resolveHomepagePingSelections(
  clientUuids: string[],
  bindings: HomepagePingTaskBindings,
  multiTaskIds: number[] = [],
) {
  const normalizedMultiTaskIds =
    normalizeHomepageMultiPingTaskIds(multiTaskIds);
  const useMultiPing = isHomepageMultiPingConfigured(normalizedMultiTaskIds);
  const singleTaskIdsByClient = useMultiPing
    ? new Map<string, number[]>()
    : resolveHomepagePingTaskIdsByClient(clientUuids, bindings);
  const multiTaskIdsByClient = useMultiPing
    ? resolveHomepagePingTaskIdsByClient(
        clientUuids,
        {},
        normalizedMultiTaskIds,
      )
    : new Map<string, number[]>();

  return {
    singleTaskIdsByClient,
    multiTaskIdsByClient,
    requestedTaskIdsByClient: useMultiPing
      ? multiTaskIdsByClient
      : singleTaskIdsByClient,
  };
}
