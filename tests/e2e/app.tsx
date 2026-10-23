import { AuthGuard } from "../../components/auth/auth-guard";
import { ProgressProvider } from "../../components/training/use-progress";
import { WeeklySyncCard } from "../../components/garmin/weekly-sync-card";
import { CurrentRunningMetrics } from "../../components/garmin/current-running-metrics";
import { RunningProgressAnalysis, TrainingRoadmap, MyProgressSummary } from "../../components/training/progress-insights";
import { usePathname } from "./platform";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { WeeklyRunningSummary } from "../../components/garmin/weekly-running-summary";
import { TodayPlan, WeeklySchedule } from "../../components/training/weekly-plan-view";
import { AppTabHeader } from "../../components/layout/app-tab-header";
import { BottomNavigation } from "../../components/layout/bottom-navigation";

function Harness() {
  const pathname = usePathname();
  const [scenario, setScenario] = useState(document.body.dataset.scenario ?? "normal");
  const [diagnostics, setDiagnostics] = useState("");
  async function control(value: string) {
    const response = await fetch("/__test/control", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: value }),
    });
    if (!response.ok) throw new Error("Fixture control failed");
    setScenario(value);
    window.dispatchEvent(new Event("traini:plan-changed"));
  }
  return <>
    <aside aria-label="Isolated test controls" style={{ padding: 8, fontSize: 12 }}>
      <label>Test scenario <select value={scenario} onChange={e => void control(e.target.value)}>
        {["normal", "reset", "empty", "partial", "stale", "pain", "review-error", "summary-error", "plan-error", "unauthorized", "forbidden", "malformed", "slow", "save-error", "save-lost", "save-conflict", "closeout-sunday", "closeout-monday", "closeout-stale", "progress-error", "auth-check-failed", "race-preparation", "race-taper", "race-recovery"].map(value => <option key={value}>{value}</option>)}
      </select></label>{" "}
      <button onClick={async () => { setDiagnostics(""); setDiagnostics(JSON.stringify(await (await fetch("/__test/diagnostics")).json())); }}>Inspect test requests</button>
      {pathname === "/auth-refresh" && <button onClick={() => window.dispatchEvent(new Event("fixture:auth-recheck"))}>Recheck fixture session</button>}
      <output aria-label="Active test scenario">{scenario}</output>
      <output aria-label="Test request counts">{diagnostics}</output>
    </aside>
    <div className="app-frame app-tab-shell">
      <AppTabHeader />
      <div className="app-tab-content">
        {pathname === "/auth-refresh" ? <AuthGuard><MyProgressSummary /></AuthGuard> : pathname.startsWith("/login") ? <p>Fixture login</p> : pathname === "/garmin-connect" ? <div className="page"><WeeklySyncCard detailed /><WeeklyRunningSummary detailed /></div> : pathname === "/today" ? <div className="page"><CurrentRunningMetrics /><TodayPlan /><details className="card mt-4 p-4"><summary className="text-xs font-medium">주간 기록 자세히</summary><WeeklyRunningSummary /></details><WeeklySyncCard /></div> : pathname === "/my" ? <div className="page"><MyProgressSummary /></div> : pathname === "/running-analysis" ? <RunningProgressAnalysis /> : pathname === "/roadmap" ? <TrainingRoadmap /> : <WeeklySchedule />}
      </div>
      <BottomNavigation />
    </div>
  </>;
}
createRoot(document.getElementById("root")!).render(<ProgressProvider><Harness /></ProgressProvider>);
