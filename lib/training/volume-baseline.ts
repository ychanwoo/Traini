import type { TrainingContext } from "./context";

type Interruption = "symptom_report" | "schedule_report" | "unknown";
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const days = (a: string, b: string) => (Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000;

/** Narrow, dated self-report hints, never diagnoses, completion, or instructions. */
export function interruptionHint(text: string | null | undefined): Interruption {
  if (!text || /만약|가정|예정|때문(?:이|은) 아니|\b(?:if|would|not because|not due to|never missed|did not miss|didn't miss|haven't missed|didn't skip)\b/i.test(text)) return "unknown";
  const missed = /못\s*(?:뛰|달|했)|(?:러닝|훈련|장거리|달리기)(?:을|를)?\s*(?:하지 않았|생략|못)|쉬었|쉬었음|\b(?:missed|skipped|could not run|did not run)\b/i;
  if (!missed.test(text)) return "unknown";
  if (/(?:통증|부상|몸살|아파서)(?:\s*(?:때문에|으로|로))|\b(?:because of|due to)\s+(?:pain|injury|illness)\b/i.test(text)) return "symptom_report";
  if (/(?:개인 일정|다른 일정|업무|출장|야근|시험|가족 일정)(?:\s*(?:때문에|으로|로))|\b(?:because of|due to)\s+(?:work|travel|scheduling|family commitments)\b/i.test(text)) return "schedule_report";
  return "unknown";
}

function skippedReason(text: string | null) {
  // A structured skipped outcome already establishes non-completion of that
  // session; accept exact reasons without requiring a second sentence.
  if (["통증", "부상", "몸살"].includes(text?.trim() ?? "")) return "symptom_report";
  if (["개인 일정", "다른 일정", "업무", "출장", "야근", "시험", "가족 일정"].includes(text?.trim() ?? "")) return "schedule_report";
  return interruptionHint(text);
}

/** Observed volume is evidence of work done, not proof of fitness or recovery. */
export function trainingVolumeBaseline(context: TrainingContext) {
  const condition = context.goal.condition;
  const weeks = context.history.weeks
    .filter(w => w.start >= context.history.start && w.end <= context.history.end && w.end <= context.asOfDate)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(-8)
    .map(w => {
      const reports = (context.workoutFeedback ?? []).filter(r => r.date >= w.start && r.date <= w.end);
      const notes = (context.weeklyFeedback ?? []).filter(n => n.startsOn === w.start && n.timezone === context.timezone);
      const hints = [...notes.map(n => interruptionHint(n.memo)),
        ...reports.filter(r => r.outcome === "skipped").map(r => skippedReason(r.skipReason))];
      const symptom = reports.some(r => ["pain", "discomfort"].includes(r.assessment?.pain ?? "") ||
        r.assessment?.fatigue === "high" || (r.assessment?.rpe ?? 0) >= 9) ||
        notes.some(n => (n.rpe ?? 0) >= 9) || hints.includes("symptom_report") ||
        (!!condition && condition.reportedOn >= w.start && condition.reportedOn <= w.end &&
          ["pain", "unwell", "tired"].includes(condition.feeling));
      const interruption: Interruption = symptom ? "symptom_report" : hints.includes("schedule_report") ? "schedule_report" : "unknown";
      const usable = w.activityCount > 0 && w.coverage.distanceCount === w.activityCount &&
        w.distanceMeters !== null && Number.isFinite(w.distanceMeters) && w.distanceMeters > 0;
      return { start: w.start, end: w.end, recordedKm: w.distanceMeters === null ? null : w.distanceMeters / 1000,
        usable, interruption, longestRunKm: (w.longestRunMeters ?? 0) / 1000 };
    });
  const measured = weeks.filter(w => w.usable);
  if (!measured.length) return null;
  const recent = measured.slice(-4);
  const recentKm = median(recent.map(w => w.recordedKm!));
  // Exclude only explicitly interrupted weeks from the habitual comparison.
  // Unknown low weeks remain; no upper-quartile selection or invented mileage.
  const habitual = measured.filter(w => w.interruption === "unknown").slice(-4);
  const supported = habitual.length >= 3;
  const habitualKm = supported ? median(habitual.map(w => w.recordedKm!)) : recentKm;
  const tail = weeks.slice(-2);
  const latest = weeks.at(-1)!;
  const recentMeasured = tail.filter(w => w.usable);
  const recentPeak = recentMeasured.length ? Math.max(...recentMeasured.map(w => w.recordedKm!)) : null;
  const recentSymptoms = tail.some(w => w.interruption === "symptom_report");
  const repeatedReduction = tail.length === 2 && tail.every(w => w.usable && w.recordedKm! < habitualKm * 0.8);
  const latestInterrupted = latest.interruption !== "unknown";
  const unknownCoverage = tail.some(w => !w.usable && w.start >= measured[0].start);
  const uncertainReduction = latest.usable && latest.recordedKm! < habitualKm * 0.8 && !latestInterrupted;
  const returning = recentSymptoms || repeatedReduction;
  // A dated normal report never restores historical capacity by itself.
  // Retain the existing 5% envelope, applied to recent recorded work on return.
  const returnAnchor = recentSymptoms ? recentMeasured.at(-1)?.recordedKm ?? null : recentPeak;
  const loadReferenceKm = returning && returnAnchor !== null ? Math.min(habitualKm, returnAnchor) : habitualKm;
  const noVolumeProgression = latestInterrupted || recentSymptoms || unknownCoverage || uncertainReduction;
  const ceilingKm = Math.min(habitualKm * (noVolumeProgression ? 1 : 1.05),
    recentPeak === null ? Infinity : recentPeak * 1.05,
    loadReferenceKm * 1.05);
  const minimumKm = recentSymptoms || unknownCoverage || uncertainReduction ? 0 :
    Math.min(loadReferenceKm, recentKm) * 0.9;
  const longestSource = returning ? recentMeasured : measured;
  const longestRunKm = longestSource.length ? Math.max(...longestSource.map(w => w.longestRunKm)) : 0;
  const lastRecorded = measured.at(-1)!;
  return {
    version: 1 as const,
    habitualKm, recentKm, loadReferenceKm, ceilingKm, minimumKm, longestRunKm,
    habitualWeeks: habitual.length, supportedHabitual: supported,
    mode: returning ? "recent_load_limited" as const : latestInterrupted ? "interrupted_week" as const :
      unknownCoverage || uncertainReduction ? "uncertain_recent_load" as const : "recorded_baseline" as const,
    noVolumeProgression,
    stale: days(lastRecorded.end, context.asOfDate) > 21,
    weeks,
  };
}
