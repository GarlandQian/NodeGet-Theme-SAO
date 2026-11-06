export class HttpRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "HttpRequestError";
  }
}

export function isAccessDeniedError(error: unknown) {
  return error instanceof HttpRequestError && [401, 403].includes(error.status);
}

export function historyRequestErrorMessage(error: unknown, fallback: string) {
  if (error instanceof HttpRequestError && error.status === 401) {
    return "读取凭据无效或已过期，请检查站点配置";
  }
  if (error instanceof HttpRequestError && error.status === 403) {
    return "没有权限读取历史数据";
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return "历史数据查询超时，请缩短时间范围或重试";
  }
  return fallback;
}
