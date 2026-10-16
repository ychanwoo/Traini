# Weekly training plans

Traini builds a weekly plan from the verified administrator's saved goal, available training days and eight completed Monday–Sunday weeks of normalized Garmin FIT history. ChatGPT subscription OAuth is the inference credential. The request does not use the Codex application's credentials or silently fall back to a paid API key.

## Use

Set the target date, distance, available days and long-run day in **내 목표 및 대회**. Complete ChatGPT connection there. In **오늘** generate the current week's remaining training, or use the next-week arrow in **일정** and generate next week. Race day and dates after it are excluded; race participation itself is not prescribed by this feature. The configured `TRAINI_TIMEZONE` is authoritative, including at midnight and DST boundaries.

For unchanged input, repeat clicks or retries return the saved week without another AI request. When goals, the reported baseline or measured activity/lap evidence changes, an explicit update action regenerates pending training transactionally. Completed workouts and past dates are preserved, including their IDs and completion timestamps. A failed update preserves the prior plan. Importing Garmin activities alone does not regenerate a plan or consume ChatGPT usage.

Today displays only the saved workout for today's training date. Future/absent dates are not marked completed automatically. Manual completion is one-way, restricted to today's running workout and persisted in the database. It is explicitly labeled as a manual completion; matching Garmin activities is a separate issue. Repeated completion requests are idempotent. The button's completed appearance is a separate UI commit candidate in `training-complete-button.tsx` and its CSS module.

## Input and output safeguards

The prompt includes the goal, aggregate history and server-computed constraints; it excludes email, profile UUID, GPS, raw FIT payloads, tokens and invented recovery metrics. Race names are untrusted data. Missing weeks are unknown, not confirmed rest.

The input contains eight completed weeks and per-session lap evidence. The policy derives a mileage reference from the median of the most recent four usable completed weeks. A recent user-reported routine is a comparison/fallback, not measured history or a fixed output template. Fewer usable weeks lower confidence but do not automatically reduce mileage or suppress established quality sessions. Actual structured-lap evidence and an explicitly labeled user-reported routine inform quality-work limits; stale records and near-race taper are separate adjustment reasons. Incomplete weeks scale the cap to remaining available days. Already recorded current-week mileage is subtracted from the weekly ceiling, and a date with a recorded run cannot receive another prescribed run. If no additional load is available, only rest is allowed. Missing current-week distance blocks generation rather than counting as zero. Weekly mileage bands, per-run distance, long-run day, up to two supported quality sessions, quality-work distance, demanding-session spacing, pace bounds, date order, exact JSON keys and missing values are validated on the server. Partial-week allocation uses usual weekday distance weights so a remaining Sunday long run is not capped to one equal fraction of a week. Structured sessions include warmup, repeats, work pace, recovery and cooldown; component distances must agree with the total. Time-only recovery is not prescribed because its distance is unknown. Near-race mileage is reduced. These are conservative product guardrails, not a medical assessment or a guarantee against injury. They do not claim the user's target time is achievable.

The provider receives `store:false`, `stream:true`, array input and developer instructions via the public Responses endpoint. No automatic retry is performed. A completed event is mandatory; deltas, incomplete/error/refusal responses and invalid JSON are never saved as plans. When the completed envelope includes final assistant text, it must match accumulated text deltas. Some subscription transports omit completed output; accumulated text is accepted only after the completed terminal event. Missing Content-Type is tolerated only with correctly framed SSE; an explicit non-SSE content type is rejected. No raw prompt/provider error text is returned or persisted as an error.

Current weather is not a forecast for future training. The existing weather card uses today's actual planned pace, when present, for a separately labeled current-weather reference. Missing pace uses effort guidance. Missing sleep/recovery measurements are displayed as unavailable rather than prototype scores.

## Persistence and concurrency

`training_generation_requests` records a durable per-user lease, bounded failure code, model and actual token usage when supplied. Billing source is `chatgpt_subscription`; `cost_usd` remains NULL because token counts do not establish a per-call dollar charge under a subscription. Provider plan/credit limits remain authoritative.

An advisory transaction lock plus a partial unique running-job index serializes generation for a user. Calls within 60 seconds and more than five attempts over a rolling 24 hours are rejected. Stale six-minute leases are recovered on a later attempt. Browser navigation does not imply a saved plan was lost: reopening polls the durable state. There is no automatic inference retry after a disconnect or ambiguous failure.

A revision covers the goal fields and FIT activity metrics. The revision is checked around the input read, at reservation and inside the final save. Changed inputs reject the save. The final RPC writes the plan, all workouts and successful job status in one transaction. Any failure rolls back every plan/workout write. A timeout may leave a successful committed result; the client reads the authoritative saved state rather than automatically generating again.

All API routes call the existing server-verified administrator allowlist. Mutation requests require matching Origin, JSON and a bounded streaming body; caller-supplied user IDs are not accepted. Plans and job history have owner-only reads; generation/completion RPCs are executable only by the service role. Browser tokens never obtain the service role. Cookie sessions and Proxy enforcement remain the next issue.

## Validation

```sh
npm run test:plan
npm run test:chatgpt
npm run test:admin
npm run test:garmin
npm run test:summary
npm run test:training
npm run test:db:plan
npm run test:db:lap
npm run lint
npm run build
```

The SQL test runs fixtures inside a transaction and rolls them back, including temporary profile changes. It verifies rollback after a workout insertion error, input revision changes, existing-plan reuse, ownership, manual completion, RPC grants, cooldown and lease recovery. Do not remove its transaction wrapper.

## Commit separation

1. `ui: style completed training button` — standalone component and CSS.
2. `feat: connect local ChatGPT subscription` — local OAuth connection, credential handling and tests.
3. `feat: generate personalized weekly plans from Garmin history` — history/lap ingestion, context, generation, transactional persistence, UI integration, tests and documentation.

Commits were authorized after validation; pushing is left to the user.

## Verification record — 2026-10-16 (America/Los_Angeles)

- Downloaded 42 activities for 2026-08-17 through 2026-10-16: 36 new FIT files, 6 reused, no failures.
- Parsed/uploaded all 42 successfully, including atomic lap evidence. The eight completed weeks contain 40 runs, with two additional activities in the current week.
- Recent measured weekly distances: 53.53, 52.57, 58.71, 56.18 km. Missing weeks are not interpreted as rest.
- Replaced the initial low-confidence 35 km next-week plan with a real 55 km subscription-generated plan. It includes 800m x5 at 3:55/km (3:08 per repetition), 400m recoveries, warmup/cooldown, a 7 km tempo work block and a 20 km long run. These are model outputs for the user's data, not hardcoded product templates.
- Verified completed-workout preservation while refreshing the current plan, same-revision idempotency and transactional rollback.
- Verified disclosure controls, manual completion persistence and mobile layouts at 320/375/430/768px.
- 100 Node tests, 103 Python tests, both transactional SQL suites, lint, TypeScript and production build passed.

## Evidence and limits

FIT lap labels are not automatically training classifications. Generic `interval` labels occur in easy auto-lap runs. Structured active/rest/warmup/cooldown blocks provide stronger evidence; overlapping, truncated and inconsistent lap totals are flagged and do not contribute to confirmed quality-work heuristics. Average session pace is not substituted for interval work pace.

The reference routine the user supplied is stored separately as `profiles.training_baseline`, with source `user_reported` and a report date. The generator can choose repetition structure using actual evidence and explain that choice. It does not require the user to specify each upcoming workout. Missing RPE, symptoms, sleep and recovery are not inferred from training effect or lap pace. Current-week automatic activity matching remains a separate issue.

References: [Garmin FIT activity/lap structure](https://developer.garmin.com/fit/articles/file-types/activity.html), [ACSM discussion of interval and recovery variables](https://acsm.org/high-intensity-interval-training-fitness/).
