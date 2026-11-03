import type { TrainingContext } from "./context";
const median = (values: number[]) => {
  const a = [...values].sort((x, y) => x - y);
  return a.length
    ? a.length % 2
      ? a[Math.floor(a.length / 2)]
      : (a[a.length / 2 - 1] + a[a.length / 2]) / 2
    : null;
};
const positive = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;
export const validHeartRate = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 254;
/** Classify measured structure, never whole-activity average pace or physiology. */
export function analyzeSession(
  session: TrainingContext["history"]["sessions"][number],
) {
  return analyzeLaps(session.evidence, session.trainingDate);
}
export function analyzeLaps(raw: unknown, date = "") {
  const e = raw as TrainingContext["history"]["sessions"][number]["evidence"];
  const unknown = {
    date: date,
    classification: "uncertain" as const,
    reason: "incomplete_or_ambiguous_laps",
    work: [] as {
      distanceMeters: number;
      timerSeconds: number;
      paceSecondsPerKm: number;
      averageHeartRate: number | null;
    }[],
    recovery: [] as {
      distanceMeters: number;
      timerSeconds: number;
      paceSecondsPerKm: number;
      averageHeartRate: number | null;
    }[],
    qualityKm: 0,
  };
  if (
    !e?.lapsComplete ||
    !Array.isArray(e.laps) ||
    !e.laps.length ||
    e.laps.length > 160
  )
    return unknown;
  if (e.laps.some((l) => !l || typeof l !== "object")) return unknown;
  const reference = median(
    e.laps
      .filter(
        (l) =>
          ["warmup", "cooldown", "rest", "recovery"].includes(
            l.intensity ?? "",
          ) &&
          positive(l.distanceMeters) &&
          l.distanceMeters >= 100 &&
          positive(l.paceSecondsPerKm),
      )
      .map((l) => l.paceSecondsPerKm!),
  );
  if (reference === null) return unknown;
  const blocks: {
    kind: string;
    distanceMeters: number;
    timerSeconds: number;
    paceSecondsPerKm: number;
    averageHeartRate: number | null;
  }[] = [];
  for (const lap of e.laps) {
    if (
      !lap ||
      !positive(lap.distanceMeters) ||
      !positive(lap.timerSeconds) ||
      !positive(lap.paceSecondsPerKm) ||
      Math.abs(
        (lap.timerSeconds / lap.distanceMeters) * 1000 - lap.paceSecondsPerKm,
      ) > 1
    )
      return unknown;
    const kind =
      lap.intensity === "active" && lap.paceSecondsPerKm < reference * 0.92
        ? "work"
        : ["rest", "recovery"].includes(lap.intensity ?? "")
          ? "recovery"
          : "other";
    const last = blocks.at(-1);
    if (last && last.kind === kind && kind !== "other") {
      last.averageHeartRate =
        last.averageHeartRate !== null && validHeartRate(lap.averageHeartRate)
          ? (last.averageHeartRate * last.timerSeconds +
              lap.averageHeartRate * lap.timerSeconds) /
            (last.timerSeconds + lap.timerSeconds)
          : null;
      last.distanceMeters += lap.distanceMeters;
      last.timerSeconds += lap.timerSeconds;
      last.paceSecondsPerKm = (last.timerSeconds / last.distanceMeters) * 1000;
    } else
      blocks.push({
        averageHeartRate: validHeartRate(lap.averageHeartRate)
          ? lap.averageHeartRate
          : null,
        kind,
        distanceMeters: lap.distanceMeters,
        timerSeconds: lap.timerSeconds,
        paceSecondsPerKm: (lap.timerSeconds / lap.distanceMeters) * 1000,
      });
  }
  const work = blocks.filter((b) => b.kind === "work");
  const first = blocks.findIndex((b) => b.kind === "work"),
    last = blocks.findLastIndex((b) => b.kind === "work");
  const between = blocks.slice(first, last + 1);
  const recovery = between.filter((b) => b.kind === "recovery");
  const classification =
    work.length === 1 &&
    work[0].distanceMeters >= 1500 &&
    work[0].timerSeconds >= 360
      ? "sustained"
      : work.length >= 2 &&
          recovery.length === work.length - 1 &&
          between.every((b, i) => b.kind === (i % 2 ? "recovery" : "work"))
        ? "interval"
        : "uncertain";
  return {
    date: date,
    classification,
    reason:
      classification === "uncertain"
        ? "ambiguous_work_structure"
        : "measured_lap_structure",
    work,
    recovery,
    qualityKm: work.reduce((sum, b) => sum + b.distanceMeters, 0) / 1000,
  };
}
