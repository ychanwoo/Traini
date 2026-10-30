import { test } from "@playwright/test";
import { coachingScenarios } from "./weekly-coaching.browser.mjs";
for (const name of ["weeklyFeedbackFailures", "weeklyFeedback", "todayWorkflow", "todayWorkflowSunday", "compactSchedule", "metricStates", "roadmapPhases", "authRefresh", "currentImport", "progressRefresh", "closeout", "importedHistory", "history", "feedback", "skip", "readFailures", "dataStates", "saveFailures", "responsive"]) {
  test(name, async ({page}) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (new URL(request.url()).origin !== "http://127.0.0.1:3027") errors.push("Unexpected external request");
    });
    if (name.startsWith("todayWorkflow")) await page.clock.setFixedTime(new Date(name === "todayWorkflowSunday" ? "2026-10-18T19:00:00Z" : "2026-10-17T19:00:00Z"));
    await page.goto("/schedule");
    const tab = { playwright: page, goto: url => page.goto(url), reload: () => page.reload(), getAXState: async () => {} };
    await coachingScenarios(tab, {set: size => page.setViewportSize(size)})[name === "todayWorkflowSunday" ? "todayWorkflow" : name]({sunday: name === "todayWorkflowSunday"});
    if (errors.length) throw new Error(errors.join("\n"));
  });
}
