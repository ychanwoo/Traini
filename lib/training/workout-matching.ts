import { dateInZone } from "@/lib/garmin/running-summary";
import type { WorkoutStep } from "./weekly-plan";

export type MatchReason =
  | "no_activity"
  | "future"
  | "multiple_activities"
  | "distance_mismatch"
  | "session_unverified"
  | "missing_metrics"
  | "already_linked"
  | "activity_changed"
  | "automatic"
  | "confirmed"
  | "user_unlinked"
  | "not_running"
  | "skipped";
export type MatchActivity = {
  id: string;
  garminId: string;
  startedAt: string;
  distanceMeters: number | null;
  timerSeconds: number | null;
  paceSecondsPerKm: number | null;
  verified: boolean;
  revision: string;
  evidence: unknown;
};
export type MatchLink = {
  workoutId: string;
  activityId: string;
  method: "automatic" | "confirmed";
  revision: string;
  active: boolean;
};
export type MatchWorkout = {
  id: string;
  date: string;
  kind: string;
  status: string;
  distanceKm: number;
  steps: WorkoutStep[];
  manualCompletedAt: string | null;
  feedback?: import("./workout-feedback").WorkoutFeedback;
  state: string;
  reason: MatchReason;
  dismissed: boolean;
};
export type MatchSnapshot = {
  planId: string;
  timezone: string;
  today: string;
  revision: string;
  workouts: MatchWorkout[];
  activities: MatchActivity[];
  links: MatchLink[];
};
export type MatchDecision = {
  workoutId: string;
  state: "unmatched" | "matched" | "review";
  reason: MatchReason;
  dismissed: boolean;
  links: {
    activityId: string;
    method: "automatic" | "confirmed";
    revision: string;
  }[];
};
export type WorkoutMatch = {
  state: "unmatched" | "matched" | "review" | "unavailable";
  reason: MatchReason | "unavailable";
  revision: string;
  source: "manual" | "garmin" | null;
  method: "automatic" | "confirmed" | null;
  actualDistanceKm: number | null;
  actualTimerSeconds: number | null;
  activities: {
    id: string;
    garminId: string;
    startedAt: string;
    distanceMeters: number | null;
    timerSeconds: number | null;
    selectable: boolean;
    linked: boolean;
  }[];
};
const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);

// Fail closed on a malformed DB response instead of treating a failed read as no runs.
export function parseMatchSnapshot(value: unknown): MatchSnapshot {
  if (
    !object(value) ||
    !uuid(value.planId) ||
    typeof value.timezone !== "string" ||
    typeof value.today !== "string" ||
    typeof value.revision !== "string" ||
    !/^[a-f0-9]{32}$/.test(value.revision) ||
    !Array.isArray(value.workouts) ||
    value.workouts.length > 7 ||
    !Array.isArray(value.activities) ||
    value.activities.length > 100 ||
    !Array.isArray(value.links) ||
    value.links.length > 200
  )
    throw new Error("match_storage");
  dateInZone(new Date(), value.timezone);
  for (const w of value.workouts) {
    if (
      !object(w) ||
      !uuid(w.id) ||
      typeof w.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(w.date) ||
      !["rest", "recovery", "easy", "long", "threshold", "interval"].includes(
        String(w.kind),
      ) ||
      !["scheduled", "today", "completed", "skipped"].includes(
        String(w.status),
      ) ||
      typeof w.distanceKm !== "number" ||
      !Number.isFinite(w.distanceKm) ||
      w.distanceKm < 0 ||
      !Array.isArray(w.steps) ||
      w.steps.length > 6 ||
      typeof w.dismissed !== "boolean" ||
      (w.manualCompletedAt !== null && typeof w.manualCompletedAt !== "string")
    )
      throw new Error("match_storage");
  }
  for (const a of value.activities) {
    if (
      !object(a) ||
      !uuid(a.id) ||
      typeof a.garminId !== "string" ||
      typeof a.startedAt !== "string" ||
      !Number.isFinite(Date.parse(a.startedAt)) ||
      typeof a.revision !== "string" ||
      !/^[a-f0-9]{32}$/.test(a.revision) ||
      typeof a.verified !== "boolean" ||
      ![a.distanceMeters, a.timerSeconds, a.paceSecondsPerKm].every(
        (v) => v === null || (typeof v === "number" && Number.isFinite(v)),
      )
    )
      throw new Error("match_storage");
  }
  for (const l of value.links)
    if (
      !object(l) ||
      !uuid(l.workoutId) ||
      !uuid(l.activityId) ||
      !["automatic", "confirmed"].includes(String(l.method)) ||
      typeof l.active !== "boolean" ||
      typeof l.revision !== "string"
    )
      throw new Error("match_storage");
  return value as MatchSnapshot;
}
function eligible(a: MatchActivity, now: Date) {
  return (
    a.verified &&
    positive(a.distanceMeters) &&
    positive(a.timerSeconds) &&
    Date.parse(a.startedAt) <= now.getTime()
  );
}
function sameDay(a: MatchActivity, w: MatchWorkout, s: MatchSnapshot) {
  return dateInZone(new Date(a.startedAt), s.timezone) === w.date;
}
function available(a: MatchActivity, w: MatchWorkout, s: MatchSnapshot) {
  // An inactive former link can move only through an explicit confirmation.
  return !s.links.some(
    (l) => l.activityId === a.id && l.workoutId !== w.id && l.active,
  );
}
type Lap = {
  distanceMeters: number;
  paceSecondsPerKm: number;
  intensity: string | null;
};
function structuredLaps(a: MatchActivity): Lap[] | null {
  const e = a.evidence;
  if (
    !object(e) ||
    e.lapsComplete !== true ||
    !Array.isArray(e.laps) ||
    e.laps.length > 160 ||
    !e.laps.length
  )
    return null;
  if (
    !e.laps.every(
      (l) =>
        object(l) && positive(l.distanceMeters) && positive(l.paceSecondsPerKm),
    )
  )
    return null;
  const laps = e.laps as Lap[];
  // "interval" is also an ordinary auto-lap label in Garmin FIT files.
  if (
    !laps.some((l) => l.intensity === "warmup") ||
    !laps.some((l) => l.intensity === "cooldown") ||
    !laps.some((l) => l.intensity === "active")
  )
    return null;
  return laps;
}
function near(actual: number, expected: number, fraction = 0.15, floor = 50) {
  return Math.abs(actual - expected) <= Math.max(floor, expected * fraction);
}
function plausiblePace(actual: number, expected: number | null) {
  return (
    expected === null ||
    (positive(expected) &&
      actual >= expected * 0.65 &&
      actual <= expected * 1.2)
  );
}
function sessionSupported(w: MatchWorkout, a: MatchActivity) {
  const laps = structuredLaps(a);
  if (w.kind === "easy" || w.kind === "recovery" || w.kind === "long") {
    if (!laps) return true;
    const expected = w.steps.find((s) => s.kind === "steady")?.paceSecondsPerKm;
    const work = laps.filter((l) => l.intensity === "active");
    // A structured steady run is still easy/long when its active pace is easy.
    // Repeated work/rest blocks or substantially faster work require review.
    return (
      positive(expected) &&
      work.length === 1 &&
      work[0].paceSecondsPerKm >= expected * 0.9
    );
  }
  if (!laps) return false;
  const work = laps.filter((l) => l.intensity === "active");
  const easy = laps.filter((l) => l.intensity !== "active");
  const weightedPace = (values: Lap[]) =>
    values.reduce((sum, l) => sum + l.distanceMeters * l.paceSecondsPerKm, 0) /
    values.reduce((sum, l) => sum + l.distanceMeters, 0);
  // Labels alone are insufficient: active blocks must also be distinguishable
  // from warmup, cooldown and recovery. This is evidence, not a threshold test.
  if (!easy.length || weightedPace(work) > weightedPace(easy) * 0.92)
    return false;
  if (w.kind === "threshold") {
    const steady = w.steps.filter((s) => s.kind === "steady");
    if (steady.length !== 1 || !positive(steady[0].distanceMeters))
      return false;
    const distance = work.reduce((sum, l) => sum + l.distanceMeters, 0);
    const pace =
      work.reduce((sum, l) => sum + l.distanceMeters * l.paceSecondsPerKm, 0) /
      distance;
    return (
      near(distance, steady[0].distanceMeters, 0.2, 200) &&
      plausiblePace(pace, steady[0].paceSecondsPerKm)
    );
  }
  const repeat = w.steps.filter((s) => s.kind === "repeats");
  if (repeat.length !== 1) return false;
  const step = repeat[0];
  if (
    !Number.isInteger(step.repetitions) ||
    step.repetitions < 2 ||
    step.repetitions > 20 ||
    !positive(step.distanceMeters) ||
    !positive(step.recoveryMeters)
  )
    return false;
  if (
    work.length !== step.repetitions ||
    !work.every(
      (l) =>
        near(l.distanceMeters, step.distanceMeters) &&
        plausiblePace(l.paceSecondsPerKm, step.paceSecondsPerKm),
    )
  )
    return false;
  const first = laps.findIndex((l) => l.intensity === "active");
  const last = laps.findLastIndex((l) => l.intensity === "active");
  const recovery = laps
    .slice(first, last + 1)
    .filter((l) => l.intensity !== "active");
  if (
    recovery.length !== step.repetitions - 1 ||
    !recovery.every(
      (l) =>
        (l.intensity === "rest" || l.intensity === "recovery") &&
        near(l.distanceMeters, step.recoveryMeters, 0.25),
    )
  )
    return false;
  if (step.recoveryAfterLast) {
    const finalRecovery = laps[last + 1];
    if (
      !finalRecovery ||
      !["rest", "recovery"].includes(finalRecovery.intensity ?? "") ||
      !near(finalRecovery.distanceMeters, step.recoveryMeters, 0.25)
    )
      return false;
  }
  // Reject two adjacent work laps: a recovery elsewhere cannot substitute for it.
  return laps
    .slice(first, last + 1)
    .every(
      (l, i, section) =>
        l.intensity !== "active" || section[i + 1]?.intensity !== "active",
    );
}
export function decideWorkoutMatches(
  s: MatchSnapshot,
  now = new Date(),
): MatchDecision[] {
  return s.workouts.map((w) => {
    const base: MatchDecision = {
      workoutId: w.id,
      state: "unmatched",
      reason: "no_activity",
      dismissed: w.dismissed,
      links: [],
    };
    if (w.kind === "rest") return { ...base, reason: "not_running" };
    if (w.status === "skipped") return { ...base, reason: "skipped" };
    if (w.date > s.today) return { ...base, reason: "future" };
    if (w.dismissed) return { ...base, reason: "user_unlinked" };
    const prior = s.links.filter(
      (l) => l.workoutId === w.id && l.method === "confirmed" && l.active,
    );
    if (!prior.length && w.reason === "activity_changed")
      return { ...base, state: "review", reason: "activity_changed" };
    if (prior.length) {
      const confirmed = prior.filter((l) => l.active);
      if (
        confirmed.length &&
        confirmed.length === prior.length &&
        confirmed.every((l) =>
          s.activities.some(
            (a) =>
              a.id === l.activityId &&
              a.revision === l.revision &&
              eligible(a, now) &&
              sameDay(a, w, s) &&
              available(a, w, s),
          ),
        )
      )
        return {
          ...base,
          state: "matched",
          reason: "confirmed",
          links: confirmed.map((l) => ({
            activityId: l.activityId,
            method: "confirmed",
            revision: l.revision,
          })),
        };
      return { ...base, state: "review", reason: "activity_changed" };
    }
    const candidates = s.activities.filter((a) => sameDay(a, w, s));
    if (!candidates.length) return base;
    if (candidates.length > 1)
      return { ...base, state: "review", reason: "multiple_activities" };
    const a = candidates[0];
    if (s.links.some((l) => l.activityId === a.id && l.workoutId !== w.id))
      return { ...base, state: "review", reason: "already_linked" };
    if (!eligible(a, now))
      return { ...base, state: "review", reason: "missing_metrics" };
    if (
      !positive(w.distanceKm) ||
      !near(a.distanceMeters!, w.distanceKm * 1000, 0.1, 50)
    )
      return { ...base, state: "review", reason: "distance_mismatch" };
    if (!sessionSupported(w, a))
      return { ...base, state: "review", reason: "session_unverified" };
    return {
      ...base,
      state: "matched",
      reason: "automatic",
      links: [{ activityId: a.id, method: "automatic", revision: a.revision }],
    };
  });
}
export function confirmWorkoutMatch(
  s: MatchSnapshot,
  workoutId: string,
  activityIds: string[],
  now = new Date(),
): MatchDecision[] {
  const decisions = decideWorkoutMatches(s, now);
  const w = s.workouts.find((w) => w.id === workoutId);
  if (
    !w ||
    w.kind === "rest" ||
    w.status === "skipped" ||
    w.date > s.today ||
    activityIds.length > 12 ||
    new Set(activityIds).size !== activityIds.length
  )
    throw new Error("match_activity");
  const selected = activityIds.map((id) =>
    s.activities.find((a) => a.id === id),
  );
  if (
    selected.some(
      (a) =>
        !a || !eligible(a, now) || !sameDay(a, w, s) || !available(a, w, s),
    )
  )
    throw new Error("match_activity");
  return decisions.map((d) =>
    d.workoutId !== workoutId
      ? d
      : {
          ...d,
          dismissed: !activityIds.length,
          state: activityIds.length ? "matched" : "unmatched",
          reason: activityIds.length ? "confirmed" : "user_unlinked",
          links: selected.map((a) => ({
            activityId: a!.id,
            revision: a!.revision,
            method: "confirmed",
          })),
        },
  );
}
export function projectWorkoutMatches(
  s: MatchSnapshot,
  now = new Date(),
): Map<string, WorkoutMatch> {
  return new Map(
    s.workouts.map((w) => {
      const links = s.links.filter((l) => l.workoutId === w.id && l.active);
      const activities = s.activities.filter((a) => sameDay(a, w, s));
      const linked = activities.filter((a) =>
        links.some((l) => l.activityId === a.id && l.revision === a.revision),
      );
      return [
        w.id,
        {
          state: w.state as WorkoutMatch["state"],
          reason: w.reason,
          revision: s.revision,
          source: linked.length
            ? "garmin"
            : w.manualCompletedAt
              ? "manual"
              : null,
          method: links[0]?.method ?? null,
          actualDistanceKm: linked.length
            ? linked.reduce((sum, a) => sum + (a.distanceMeters ?? 0), 0) / 1000
            : null,
          actualTimerSeconds: linked.length
            ? linked.reduce((sum, a) => sum + (a.timerSeconds ?? 0), 0)
            : null,
          activities: activities.map((a) => ({
            id: a.id,
            garminId: a.garminId,
            startedAt: a.startedAt,
            distanceMeters: a.distanceMeters,
            timerSeconds: a.timerSeconds,
            selectable:
              w.kind !== "rest" &&
              w.status !== "skipped" &&
              w.date <= s.today &&
              eligible(a, now) &&
              available(a, w, s),
            linked: linked.some((l) => l.id === a.id),
          })),
        },
      ];
    }),
  );
}
export const matchReasonMessage: Record<MatchReason | "unavailable", string> = {
  no_activity:
    "이 날짜에 저장된 Garmin 러닝이 없어요. 미수집 기록을 휴식이나 미수행으로 판단하지 않아요.",
  future: "훈련 날짜가 지나면 Garmin 기록을 확인해요.",
  multiple_activities:
    "같은 날 러닝이 여러 개예요. 워밍업·본운동·쿨다운 등 실제 이 훈련에 해당하는 기록을 선택해 주세요.",
  distance_mismatch:
    "계획 거리와 차이가 있어 자동 완료하지 않았어요. 실제 수행한 훈련인지 확인해 주세요.",
  session_unverified:
    "계획과 같은 세션인지 확인할 랩 근거가 부족하거나 구성이 달라요. 기록을 확인해 주세요.",
  missing_metrics: "검증된 거리·시간 정보가 부족해 연결하지 않았어요.",
  already_linked:
    "다른 훈련의 연결 이력이 있어 자동 연결하지 않았어요. 연결 가능한 기록을 직접 확인해 주세요.",
  activity_changed:
    "연결했던 기록이 바뀌었어요. 최신 기록을 다시 확인해 주세요.",
  automatic:
    "날짜·거리·세션 조건에 맞는 Garmin 러닝을 자동 연결했어요. 운동 효과나 회복 상태를 판정한 결과는 아니에요.",
  confirmed: "직접 확인한 Garmin 기록으로 연결했어요.",
  user_unlinked: "연결을 해제했어요. 자동으로 다시 연결하지 않아요.",
  not_running: "휴식일에는 러닝 기록으로 완료 처리하지 않아요.",
  skipped: "건너뛴 훈련은 자동 완료하지 않아요.",
  unavailable:
    "Garmin 연결 상태를 확인하지 못했어요. 기존 계획과 완료 상태는 유지했으니 다시 확인해 주세요.",
};
