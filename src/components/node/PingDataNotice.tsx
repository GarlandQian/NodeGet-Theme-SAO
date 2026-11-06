import type { PingDataIssue } from "@/types/models";
import { pingIssueLabel } from "@/utils/pingStatus";

export function PingDataNotice({ issue }: { issue?: PingDataIssue }) {
  if (!issue) return null;
  return (
    <small
      role="status"
      title={issue.message}
      aria-label={issue.message}
      style={{ color: "var(--text-secondary)", fontSize: "10px", fontWeight: 400, marginLeft: "4px" }}
    >
      {pingIssueLabel(issue)}
    </small>
  );
}
