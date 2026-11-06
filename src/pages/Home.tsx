import { lazy, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { HomeFooter } from "@/components/shell/HomeFooter";
import { NodeGrid } from "@/components/node/NodeGrid";
import { FloatingControls } from "@/components/shell/FloatingControls";
import { Spinner } from "@/components/ui/Spinner";
import { useThemeSettings } from "@/hooks/useThemeSettings";

const ThemeManage = lazy(() =>
  import("@/pages/ThemeManage").then((module) => ({ default: module.ThemeManage })),
);

function HomeDashboard() {
  const [controlsExpanded, setControlsExpanded] = useState(false);
  const themeSettings = useThemeSettings();
  const homeReady = themeSettings.isReady;

  useEffect(() => {
    document.body.classList.toggle("is-nav-controls-expanded", controlsExpanded);
    return () => {
      document.body.classList.remove("is-nav-controls-expanded");
    };
  }, [controlsExpanded]);

  return (
    <div
      className={`home-dashboard relative${controlsExpanded ? " is-controls-expanded" : ""}`}
    >
      {homeReady && <FloatingControls onExpandedChange={setControlsExpanded} />}
      <NodeGrid />
      <HomeFooter />
    </div>
  );
}

export function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const windowView =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("view")
      : null;
  const isThemeManageView =
    searchParams.get("view") === "theme-manage" || windowView === "theme-manage";

  // 若用户直接在浏览器 URL (而非 hash) 传入了 ?view=theme-manage，自动将其同步入 hash 路由
  useEffect(() => {
    if (typeof window !== "undefined") {
      const windowParams = new URLSearchParams(window.location.search);
      if (
        windowParams.get("view") === "theme-manage" &&
        searchParams.get("view") !== "theme-manage"
      ) {
        const next = new URLSearchParams(searchParams);
        windowParams.forEach((val, key) => {
          next.set(key, val);
        });
        setSearchParams(next, { replace: true });
      }
    }
  }, [searchParams, setSearchParams]);

  if (isThemeManageView) {
    return (
        <Suspense
          fallback={
            <div className="flex min-h-[60vh] items-center justify-center">
              <Spinner size={24} />
            </div>
          }
        >
          <ThemeManage />
        </Suspense>
    );
  }

  return <HomeDashboard />;
}
