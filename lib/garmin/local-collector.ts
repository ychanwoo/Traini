import { spawn } from "node:child_process";
import { access, lstat, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseJob, previousWeek, type CollectionSnapshot } from "./collection";

const statusPath = () => path.join(/* turbopackIgnore: true */ homedir(), "Projects/Traini-data/garmin/web-sync.json");
// A server setting keeps the machine's virtualenv out of Next's asset tracing.
const pythonPath = () => process.env.TRAINI_COLLECTOR_PYTHON;
const enabled = () => process.env.TRAINI_LOCAL_COLLECTOR_ENABLED === "true" && process.platform === "darwin" && !process.env.VERCEL;

function timezone(): string {
  return process.env.TRAINI_TIMEZONE ?? "America/Los_Angeles";
}

function uploadConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const owner = process.env.TRAINI_ADMIN_USER_ID;
  if (!url || !/^https:\/\/kmmutfcgshellvjgpick\.supabase\.co\/?$/.test(url) || !key
    || !owner || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(owner)) return null;
  return { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, TRAINI_ADMIN_USER_ID: owner };
}

export async function collectionSnapshot(): Promise<CollectionSnapshot> {
  let period;
  try { period = previousWeek(timezone()); }
  catch { return { available: false, period: previousWeek("America/Los_Angeles"), job: null, notice: "timezone_invalid" }; }
  const snapshot: CollectionSnapshot = { available: false, period, job: null, notice: null };
  if (!enabled()) return { ...snapshot, notice: "local_only" };
  const executable = pythonPath();
  if (!executable || !path.isAbsolute(executable)) return { ...snapshot, notice: "setup_required" };
  try { await access(/* turbopackIgnore: true */ executable, constants.X_OK); } catch { return { ...snapshot, notice: "setup_required" }; }
  snapshot.available = Boolean(uploadConfiguration());
  if (!snapshot.available) snapshot.notice = "upload_setup_required";
  try {
    const info = await lstat(/* turbopackIgnore: true */ statusPath());
    if (info.isSymbolicLink() || !info.isFile() || info.size > 16_384) return { ...snapshot, notice: "status_unavailable" };
    const raw = JSON.parse(await readFile(/* turbopackIgnore: true */ statusPath(), "utf8"));
    snapshot.job = parseJob(raw);
    if (!snapshot.job) return { ...snapshot, notice: "status_unavailable" };
    if (snapshot.job.status === "running") {
      let alive = Number.isSafeInteger(raw.pid) && raw.pid > 0;
      if (alive) { try { process.kill(raw.pid, 0); } catch { alive = false; } }
      if (!alive || Date.now() - Date.parse(snapshot.job.startedAt) > 330_000) {
        snapshot.job = { ...snapshot.job, status: "failed", failedStage: snapshot.job.stage, stage: "finished", errorCode: "interrupted" };
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") snapshot.notice = "status_unavailable";
  }
  return snapshot;
}

export class CollectionStartError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export async function startCollection(authenticatedOwner: string): Promise<void> {
  const snapshot = await collectionSnapshot();
  if (!snapshot.available) throw new CollectionStartError(snapshot.notice ?? "local_only");
  if (snapshot.job?.status === "running") throw new CollectionStartError("busy");
  const configuration = uploadConfiguration();
  if (!configuration || configuration.TRAINI_ADMIN_USER_ID !== authenticatedOwner) throw new CollectionStartError("upload_setup_required");
  const executable = pythonPath();
  if (!executable) throw new CollectionStartError("setup_required");
  return new Promise((resolve, reject) => {
    // Fixed executable/module/arguments. No shell and no request-provided input.
    // The verified owner's server credentials go only to this local process.
    // Never inherit unrelated app secrets or put credentials in arguments/status.
    const child = spawn(/* turbopackIgnore: true */ executable, ["-m", "traini_collector.web", "--timezone", timezone()], {
      cwd: homedir(), detached: true, stdio: ["ignore", "pipe", "ignore"],
      env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: homedir(), LANG: "en_US.UTF-8", PYTHONUNBUFFERED: "1", PYTHONNOUSERSITE: "1", ...configuration },
    });
    let settled = false;
    let output = "";
    const finish = (code?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.destroy();
      child.unref();
      if (code) reject(new CollectionStartError(code)); else resolve();
    };
    const timer = setTimeout(() => { child.kill("SIGTERM"); finish("start_failed"); }, 8_000);
    child.once("error", () => finish("start_failed"));
    child.once("exit", () => finish("start_failed"));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 4_096) { child.kill("SIGTERM"); finish("start_failed"); return; }
      if (!output.includes("\n")) return;
      try {
        const message = JSON.parse(output.split("\n")[0]);
        if (message.kind === "started") finish();
        else finish(message.kind === "busy" ? "busy" : "start_failed");
      } catch { child.kill("SIGTERM"); finish("start_failed"); }
    });
  });
}
