import { useState } from "react";
import { createRoot } from "react-dom/client";
import { WeeklyRunningSummary } from "../../components/garmin/weekly-running-summary";
import { TodayPlan, WeeklySchedule } from "../../components/training/weekly-plan-view";
import { AppTabHeader } from "../../components/layout/app-tab-header";
import { BottomNavigation } from "../../components/layout/bottom-navigation";

function Harness() {
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
        {["normal", "reset", "empty", "partial", "stale", "pain", "review-error", "summary-error", "plan-error", "unauthorized", "forbidden", "malformed", "slow", "save-error", "save-lost", "save-conflict"].map(value => <option key={value}>{value}</option>)}
      </select></label>{" "}
      <button onClick={async () => { setDiagnostics(""); setDiagnostics(JSON.stringify(await (await fetch("/__test/diagnostics")).json())); }}>Inspect test requests</button>
      <output aria-label="Active test scenario">{scenario}</output>
      <output aria-label="Test request counts">{diagnostics}</output>
    </aside>
    <div className="app-frame app-tab-shell">
      <AppTabHeader />
      <div className="app-tab-content">
        {window.location.pathname === "/today" ? <div className="page"><WeeklyRunningSummary /><TodayPlan /></div> : <WeeklySchedule />}
      </div>
      <BottomNavigation />
    </div>
  </>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
