// Independent checks of saved API output. This is an audit, not a replacement
// for the stricter generation validator or a medical clearance to run.
const isoDay = (date) =>
  ((new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7) + 1;
const positive = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;
export function auditSavedPlan(result, context, preview, validatePrescription) {
  if (!result.plan) return { state: "missing", issues: [], pendingRuns: 0 };
  const issues = new Set();
  const workouts = result.plan.workouts;
  const dates = workouts.map((w) => w.date);
  if (new Set(dates).size !== dates.length) issues.add("duplicate_date");
  if (
    workouts.some(
      (w) => w.date < result.period.start || w.date > result.period.end,
    )
  )
    issues.add("outside_week");
  const pending = workouts.filter(
    (w) =>
      w.date >= context.asOfDate &&
      !w.completed &&
      w.status !== "skipped" &&
      !(w.feedback?.version > 0),
  );
  const runs = pending.filter((w) => w.kind !== "rest");
  const total = runs.reduce((n, w) => n + w.distanceKm, 0);
  if (!Number.isFinite(total) || total > preview.limits.maxWeekKm + 1e-7)
    issues.add("weekly_distance");
  if (runs.some((w) => !context.goal.trainingDays.includes(isoDay(w.date))))
    issues.add("unavailable_day");
  if (
    runs.some(
      (w) =>
        !positive(w.distanceKm) ||
        w.distanceKm > preview.limits.maxRunKm + 1e-7,
    )
  )
    issues.add("session_distance");
  if (
    runs.filter((w) => ["interval", "threshold"].includes(w.kind)).length >
    preview.limits.maxHardSessions
  )
    issues.add("quality_count");
  if (preview.guidance.condition?.requiresRecheck && runs.length)
    issues.add("unresolved_condition");
  const calendar = preview.guidance.raceCalendar;
  if (calendar) {
    if (
      runs.some(
        (w) =>
          calendar.restDates.includes(w.date) ||
          calendar.raceDates.includes(w.date),
      )
    )
      issues.add("race_rest_date");
    if (
      runs.some(
        (w) =>
          calendar.easyOnlyDates.includes(w.date) &&
          !["easy", "recovery"].includes(w.kind),
      )
    )
      issues.add("race_easy_only");
    if (
      runs.some(
        (w) => w.kind === "long" && calendar.noLongRunDates.includes(w.date),
      )
    )
      issues.add("race_no_long_run");
  }
  for (const w of pending) {
    if (w.kind === "rest") {
      if (
        w.distanceKm !== 0 ||
        w.paceSecondsPerKm !== null ||
        w.steps.length !== 0
      )
        issues.add("rest_structure");
      continue;
    }
    if (w.paceSecondsPerKm !== null && !positive(w.paceSecondsPerKm))
      issues.add("invalid_pace");
    let distance = 0;
    for (const step of w.steps) {
      if (
        !positive(step.distanceMeters) ||
        !Number.isInteger(step.repetitions) ||
        step.repetitions < 1 ||
        !Number.isFinite(step.recoveryMeters) ||
        step.recoveryMeters < 0
      )
        issues.add("invalid_step");
      if (step.paceSecondsPerKm !== null && !positive(step.paceSecondsPerKm))
        issues.add("invalid_pace");
      const repeats = step.kind === "repeats";
      distance += step.distanceMeters * (repeats ? step.repetitions : 1);
      if (repeats)
        distance +=
          step.recoveryMeters *
          (step.repetitions - (step.recoveryAfterLast ? 0 : 1));
    }
    if (
      !Number.isFinite(distance) ||
      Math.abs(distance - w.distanceKm * 1000) > 50
    )
      issues.add("step_distance");
  }
  const demanding = runs
    .filter((w) => ["interval", "threshold", "long"].includes(w.kind))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (
    demanding.some(
      (w, i) =>
        i &&
        (Date.parse(w.date) - Date.parse(demanding[i - 1].date)) / 86400000 < 2,
    )
  )
    issues.add("demanding_spacing");
  if (
    !validatePrescription(
      { summary: result.plan.summary, workouts: pending },
      preview.guidance.rules,
    )
  )
    issues.add("prescription_bounds");
  return {
    state: result.inputsChanged
      ? "stale"
      : issues.size
        ? "invalid"
        : "validated",
    issues: [...issues],
    pendingRuns: runs.length,
  };
}
