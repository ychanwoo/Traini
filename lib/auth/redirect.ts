const destinations = new Set(["/today", "/schedule", "/roadmap", "/my", "/my/goals", "/my/privacy", "/my/support", "/goal-setting", "/running-analysis", "/garmin-connect"]);

// Only known app paths: reject protocol-relative URLs, encoded separators and auth loops.
export function safeDestination(value: string | null | undefined): string {
  return value && destinations.has(value) ? value : "/today";
}
