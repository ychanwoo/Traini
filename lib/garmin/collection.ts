export type CollectionPeriod = { start: string; end: string; timezone: string };
export type CollectionCounts = { found: number; downloaded: number; skipped: number; failed: number };
export type CollectionJob = {
  id: string;
  status: "running" | "succeeded" | "partial" | "failed";
  stage: "authenticating" | "collecting" | "finished";
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  period: CollectionPeriod;
  counts: CollectionCounts;
};
export type CollectionSnapshot = {
  available: boolean;
  period: CollectionPeriod;
  job: CollectionJob | null;
  notice: string | null;
};

export function previousWeek(timezone: string, now = new Date()): CollectionPeriod {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((value) => value.type === type)?.value);
  const day = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) - 7);
  const start = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 6);
  return { start, end: day.toISOString().slice(0, 10), timezone };
}

export function parseJob(value: unknown): CollectionJob | null {
  if (!value || typeof value !== "object") return null;
  const job = value as Record<string, unknown>;
  if (typeof job.id !== "string" || !/^[a-f0-9-]{36}$/.test(job.id)) return null;
  if (!["running", "succeeded", "partial", "failed"].includes(String(job.status))) return null;
  if (!["authenticating", "collecting", "finished"].includes(String(job.stage))) return null;
  if (typeof job.startedAt !== "string" || !Number.isFinite(Date.parse(job.startedAt))) return null;
  if (job.finishedAt !== null && (typeof job.finishedAt !== "string" || !Number.isFinite(Date.parse(job.finishedAt)))) return null;
  if (job.errorCode !== null && !["auth_required", "rate_limited", "connection", "storage", "timeout", "collector_failed", "partial_download", "interrupted"].includes(String(job.errorCode))) return null;
  const period = job.period as CollectionPeriod | undefined;
  const counts = job.counts as CollectionCounts | undefined;
  if (!period || !/^\d{4}-\d{2}-\d{2}$/.test(period.start) || !/^\d{4}-\d{2}-\d{2}$/.test(period.end) || typeof period.timezone !== "string") return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: period.timezone }); } catch { return null; }
  if (!counts || ![counts.found, counts.downloaded, counts.skipped, counts.failed].every((count) => Number.isSafeInteger(count) && count >= 0)) return null;
  // Explicit projection: never return worker PIDs, paths, or extra JSON fields.
  return {
    id: job.id, status: job.status as CollectionJob["status"], stage: job.stage as CollectionJob["stage"],
    startedAt: job.startedAt, finishedAt: job.finishedAt as string | null,
    errorCode: job.errorCode as string | null,
    period: { start: period.start, end: period.end, timezone: period.timezone },
    counts: { found: counts.found, downloaded: counts.downloaded, skipped: counts.skipped, failed: counts.failed },
  };
}
