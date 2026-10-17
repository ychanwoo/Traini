// Synthetic records only. No account, environment or provider credentials.
export const TODAY = "2026-10-17";
export const LATEST = "2026-10-05";
const addDays = (day, count) => new Date(Date.parse(day + "T00:00:00Z") + count * 86400000).toISOString().slice(0, 10);
export function initialState() {
  const plans = {};
  for (const [week, start] of Object.entries({ previous: LATEST, current: "2026-10-12", next: "2026-10-19" })) {
    plans[week] = {
      period: { start, end: addDays(start, 6), today: TODAY, timezone: "America/Los_Angeles" },
      generating: false, generationError: null, inputsChanged: false, races: [],
      plan: {
        id: `plan-${week}`, startsOn: start, endsOn: addDays(start, 6), summary: "기록과 현재 조건을 바탕으로 작성한 테스트 계획이에요.",
        targetDistanceKm: 35, createdAt: "2026-10-17T12:00:00Z", model: "fixture-model",
        review: { id: "review-latest", startsOn: LATEST, revision: "revision-1" },
        workouts: Array.from({length: 7}, (_, i) => ({
          id: `${week}-${i}`, date: addDays(start, i), kind: i === 1 || i === 3 ? "rest" : "easy",
          title: i === 1 || i === 3 ? "휴식" : "이지런", purpose: "편안한 강도로 달려요.",
          distanceKm: i === 1 || i === 3 ? 0 : 7, paceSecondsPerKm: i === 1 || i === 3 ? null : 330,
          effort: i === 1 || i === 3 ? "rest" : "conversational", steps: [],
          completed: false, status: "planned", feedback: null,
          matching: { state: "unmatched", reason: "no_activities", revision: "matching-1", source: null, activities: [], actualDistanceKm: null },
        })),
      },
    };
  }
  return { plans, scenario: "normal", feedbackRequests: [], appliedRequests: [], unexpectedRequests: [], reviewGenerationRequests: 0, reviewRequests: 0, planRequests: 0, inferenceRequests: 0 };
}
export function planView(state, week) {
  const view = structuredClone(state.plans[week] ?? state.plans.current);
  if (state.scenario === "empty") view.plan = null;
  if (state.scenario === "stale") view.inputsChanged = true;
  if (state.scenario === "pain") for (const w of view.plan.workouts) {
    if (!w.completed && w.status !== "skipped" && w.date >= TODAY) {
      Object.assign(w, { kind: "rest", title: "휴식", distanceKm: 0, paceSecondsPerKm: null, effort: "rest", purpose: "통증 상태를 다시 확인해요." });
    }
  }
  return view;
}
export function reviewView(state, start, buildCoachingFeedback) {
  const selected = start || LATEST;
  const old = selected !== LATEST;
  const workouts = state.plans.previous.plan.workouts;
  const metrics = {
    plannedKm: 35, actualKm: old ? 42 : 38.5, activityCount: 5, distanceKnown: 5,
    baselineKm: 35, structuredQualitySessions: 0, supportedQualitySessions: 2,
    garminCompleted: 0, manualCompleted: workouts.filter(w => w.completed).length,
    unconfirmed: workouts.filter(w => w.kind !== "rest" && !w.completed && w.status !== "skipped").length,
    explicitlySkipped: workouts.filter(w => w.status === "skipped").length,
    feedbackReports: workouts.filter(w => w.feedback).length,
    additionalRuns: 0, unassignedRuns: 5, hasPlan: true,
    activities: [7, 8, 7, 6.5, old ? 13.5 : 10].map(distanceKm => ({distanceKm})),
    sessions: old ? [] : workouts.filter(w => w.kind !== "rest").map(w => ({ date: w.date, completion: w.status === "skipped" ? "skipped" : w.completed ? "manual" : "unconfirmed", feedback: w.feedback })),
  };
  if (state.scenario === "partial") Object.assign(metrics, { distanceKnown: 4, actualKm: 28.5 });
  if (state.scenario === "empty") Object.assign(metrics, { actualKm: null, activityCount: 0, distanceKnown: 0, baselineKm: null, activities: [], sessions: [], hasPlan: false, plannedKm: null, unconfirmed: null });
  const review = state.scenario === "empty" ? null : {
    id: old ? "review-older" : "review-latest", revision: "revision-1", fresh: state.scenario !== "stale" && (old || !workouts.some(w => w.feedback)), metrics,
    model: "fixture-model", createdAt: "2026-10-17T12:00:00Z",
    content: { summary: old ? "이전 주에는 42km를 달렸어요." : "비교 기준보다 거리가 늘었어요. 현재 상태를 확인하며 훈련량을 유지해요.",
      observations: [{ text: "거리만으로 회복 여부를 판단하지 않아요.", evidence: ["actualKm"] }],
      nextWeek: { direction: "maintain", volumeChangePercent: 0, maxQualitySessions: 2, rationale: "훈련량을 더 늘리기 전에 소화 상태를 확인해요." },
      limitations: ["recovery_unavailable"],
    },
  };
  const result = { period: { startsOn: selected, endsOn: addDays(selected, 6), timezone: "America/Los_Angeles" }, latestStartsOn: LATEST, generating: false, generationError: null, metrics, review };
  result.coaching = buildCoachingFeedback(result, { today: TODAY, condition: state.scenario === "pain" ? {reportedOn: TODAY, feeling: "pain"} : null, current: planView(state, "current"), next: planView(state, "next") });
  return result;
}
export function saveFeedback(state, body) {
  const workout = Object.values(state.plans).flatMap(p => p.plan.workouts).find(w => w.id === body.workoutId);
  if (!workout) return { status: 404, error: "훈련을 찾지 못했어요." };
  state.feedbackRequests.push(structuredClone(body));
  const previous = state.appliedRequests.find(entry => entry.requestId === body.requestId);
  if (previous) return { status: 200 };
  if (state.scenario === "save-error") return { status: 503, error: "테스트 저장 실패: 입력을 유지하고 다시 확인해 주세요." };
  if (state.scenario === "save-conflict" || body.version !== (workout.feedback?.version ?? 0)) return { status: 409, error: "다른 화면에서 훈련이 변경됐어요. 저장 상태를 확인해 주세요." };
  state.appliedRequests.push(structuredClone(body));
  workout.status = body.outcome === "unconfirmed" ? "planned" : body.outcome;
  workout.completed = body.outcome === "completed";
  workout.feedback = body.outcome === "unconfirmed" ? null : { version: body.version + 1, assessment: body.assessment, skipReason: body.skipReason, reportedAt: "2026-10-17T18:00:00Z" };
  for (const plan of Object.values(state.plans)) plan.inputsChanged = true;
  return state.scenario === "save-lost" ? {status: 502, error: "응답을 확인하지 못했어요. 저장 여부를 먼저 확인해 주세요."} : {status: 200};
}
export const prescription = {
  period: { start: "2026-10-19", end: "2026-10-25", timezone: "America/Los_Angeles" },
  limits: { maxWeekKm: 45, maxRunKm: 16, maxHardSessions: 2 },
  guidance: { condition: null, warnings: [], confirmedSessions: 0, manualSessions: 0, unconfirmedSessions: 5,
    goals: [], rules: { bounds: [], intervals: [] }, principles: [] },
};
