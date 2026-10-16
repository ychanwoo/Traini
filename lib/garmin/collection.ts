export type CollectionPeriod = { start: string; end: string; timezone: string };
export type CollectionCounts = { found: number; downloaded: number; skipped: number; failed: number };
export type ParsingCounts = { found: number; processed: number; skipped: number; failed: number };
export type UploadCounts = { found: number; eligible: number; validated: number; inserted: number; updated: number; unchanged: number; failed: number; excluded: number };
export const IMPORT_FINISHED_EVENT = "traini:garmin-import-finished";
export type CollectionJob = {
  version: 1 | 2;
  id: string;
  status: "running" | "succeeded" | "partial" | "failed";
  stage: "authenticating" | "collecting" | "parsing" | "uploading" | "finished";
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  period: CollectionPeriod;
  counts: CollectionCounts;
  parsing: ParsingCounts | null;
  upload: UploadCounts | null;
  uploadStarted: boolean;
  failedStage: string | null;
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
  if (typeof job.status !== "string" || !["running", "succeeded", "partial", "failed"].includes(job.status)) return null;
  if (typeof job.stage !== "string" || !["authenticating", "collecting", "parsing", "uploading", "finished"].includes(job.stage)) return null;
  if (typeof job.startedAt !== "string" || !Number.isFinite(Date.parse(job.startedAt))) return null;
  if (job.finishedAt !== null && (typeof job.finishedAt !== "string" || !Number.isFinite(Date.parse(job.finishedAt)))) return null;
  if (job.errorCode !== null && (typeof job.errorCode !== "string" || !["auth_required", "rate_limited", "connection", "storage", "timeout", "collector_failed", "partial_download", "interrupted", "partial_parse", "partial_upload", "parse_failed", "upload_failed", "upload_connection", "upload_setup_required"].includes(job.errorCode))) return null;
  const period = job.period as CollectionPeriod | undefined;
  const counts = job.counts as CollectionCounts | undefined;
  if (!period || typeof period.start !== "string" || typeof period.end !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(period.start) || !/^\d{4}-\d{2}-\d{2}$/.test(period.end) || typeof period.timezone !== "string") return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: period.timezone }); } catch { return null; }
  if (!counts || ![counts.found, counts.downloaded, counts.skipped, counts.failed].every((count) => Number.isSafeInteger(count) && count >= 0)) return null;
  if (job.version !== undefined && job.version !== 1 && job.version !== 2) return null;
  const parsing = projectCounts(job.parsing, ["found", "processed", "skipped", "failed"]);
  const upload = projectCounts(job.upload, ["found", "eligible", "validated", "inserted", "updated", "unchanged", "failed", "excluded"]);
  if (job.version === 2) {
    if (!parsing || !upload || typeof job.uploadStarted !== "boolean") return null;
    if (job.failedStage !== null && (typeof job.failedStage !== "string"
      || !["authenticating", "collecting", "parsing", "uploading"].includes(job.failedStage))) return null;
  }
  // Explicit projection: never return worker PIDs, paths, or extra JSON fields.
  return {
    version: job.version === 2 ? 2 : 1,
    id: job.id, status: job.status as CollectionJob["status"], stage: job.stage as CollectionJob["stage"],
    startedAt: job.startedAt, finishedAt: job.finishedAt as string | null,
    errorCode: job.errorCode as string | null,
    period: { start: period.start, end: period.end, timezone: period.timezone },
    counts: { found: counts.found, downloaded: counts.downloaded, skipped: counts.skipped, failed: counts.failed },
    parsing: job.version === 2 ? parsing as ParsingCounts : null,
    upload: job.version === 2 ? upload as UploadCounts : null,
    uploadStarted: job.version === 2 && job.uploadStarted === true,
    failedStage: job.version === 2 ? job.failedStage as string | null : null,
  };
}

function projectCounts<K extends string>(value: unknown, keys: K[]): Record<K, number> | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!keys.every((key) => Number.isSafeInteger(raw[key]) && (raw[key] as number) >= 0)) return null;
  return Object.fromEntries(keys.map((key) => [key, raw[key]])) as Record<K, number>;
}
