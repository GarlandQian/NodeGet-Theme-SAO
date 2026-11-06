import { historyRequestErrorMessage, HttpRequestError, isAccessDeniedError } from "@/services/requestErrors";
import type { PingDataIssue } from "@/types/models";

export function pingRequestIssue(error: unknown): PingDataIssue {
  if (isAccessDeniedError(error)) {
    return { status: "forbidden", message: historyRequestErrorMessage(error, "没有权限读取 Ping 数据") };
  }
  if (error instanceof HttpRequestError && error.status === 404) {
    return { status: "unavailable", message: "暂无 Ping 数据或尚未配置任务" };
  }
  return { status: "error", message: historyRequestErrorMessage(error, "Ping 数据加载失败，请稍后重试") };
}

export function pingIssueLabel(issue?: PingDataIssue): string | undefined {
  if (!issue) return undefined;
  return { partial: "部分数据", forbidden: "无权限", unavailable: "暂无数据", error: "加载失败" }[issue.status];
}
