import { Link } from "react-router-dom";
import { Flag } from "@/components/ui/Flag";
import type { NodeInfo } from "@/types/models";

export function NodeUnavailable({ node, className }: { node: NodeInfo & { dataStatus?: string }; className: string }) {
  return (
    <article id={`node-card-${node.uuid}`} className={`${className} p-5`}>
      <Link to={`/instance/${encodeURIComponent(node.uuid)}`} className="flex items-center gap-2 font-semibold">
        <Flag region={node.region} size={16} />
        {node.name}
      </Link>
      {node.source_name && <p className="mt-1 text-[11px] text-(--text-tertiary)">{node.source_name}</p>}
      <p role="status" className="py-5 text-[13px] text-(--text-secondary)">{node.dataStatus === "forbidden" ? "没有权限读取实时数据" : node.dataStatus === "partial" ? "部分实时指标缺失" : "实时数据暂不可用"}</p>
      <p className="text-[12px] text-(--text-tertiary)">等待有效上报或主控恢复连接</p>
    </article>
  );
}
