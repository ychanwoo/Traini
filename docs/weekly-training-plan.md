# Weekly training plans

Traini builds a weekly plan from the verified administrator's saved goal, available training days and eight Monday–Sunday weeks of normalized Garmin FIT history (normally completed weeks, or including the explicitly closed current Sunday week for next-week planning). ChatGPT subscription OAuth is the inference credential. The request does not use the Codex application's credentials or silently fall back to a paid API key.

## Use

Set the target date, distance, available days and long-run day in **내 목표 및 대회**. Complete ChatGPT connection there. In **오늘** generate the current week's remaining training, or use the next-week arrow in **일정** and generate next week. Registered race dates are separate calendar events rather than ordinary prescribed runs. Preparation, taper and post-race recovery rules consider all registered races; the application does not confirm participation or recovery from the calendar alone. The configured `TRAINI_TIMEZONE` is authoritative, including at midnight and DST boundaries.

For unchanged input, repeat clicks or retries return the saved week without another AI request. When goals, the reported baseline or measured activity/lap evidence changes, an explicit update action regenerates pending training transactionally. Completed workouts and past dates are preserved, including their IDs and completion timestamps. A failed update preserves the prior plan. Importing Garmin activities alone does not regenerate a plan or consume ChatGPT usage.

Today displays the saved workout for today's training date. Schedule also supports late feedback and explicit completion/skip corrections for eligible training dates. Garmin-confirmed completion and manual completion remain distinct; neither an absent record nor a calendar rollover automatically completes a session. See [workout feedback](workout-feedback.md) and [Garmin matching](garmin-workout-matching.md).

## Input and output safeguards

The prompt includes goals, aggregate history, selected self-reports/feedback and server-computed constraints; it excludes email, profile UUID, GPS, raw FIT payloads, tokens and invented recovery metrics. Race names are untrusted data. Missing weeks are unknown, not confirmed rest.

The input contains the selected eight-week history and per-session lap evidence. Next-week planning after an explicit Sunday closeout can include that closed week without shifting today's date; see [weekly closeout](weekly-training-closeout.md). The policy derives a mileage reference from the median of the most recent four usable weeks in that selected history. A recent user-reported routine is a comparison/fallback, not measured history or a fixed output template. Fewer usable weeks lower confidence but do not automatically reduce mileage or suppress established quality sessions. Actual structured-lap evidence and an explicitly labeled user-reported routine inform quality-work limits; stale records and near-race taper are separate adjustment reasons. Incomplete weeks scale the cap to remaining available days. Already recorded current-week mileage is subtracted from the weekly ceiling, and a date with a recorded run cannot receive another prescribed run. If no additional load is available, only rest is allowed. Missing current-week distance blocks generation rather than counting as zero. Weekly mileage bands, per-run distance, long-run day, up to two supported quality sessions, quality-work distance, demanding-session spacing, pace bounds, date order, exact JSON keys and missing values are validated on the server. Partial-week allocation uses usual weekday distance weights so a remaining Sunday long run is not capped to one equal fraction of a week. Structured sessions include warmup, repeats, work pace, recovery and cooldown; component distances must agree with the total. Time-only recovery is not prescribed because its distance is unknown. Near-race mileage is reduced. These are conservative product guardrails, not a medical assessment or a guarantee against injury. They do not claim the user's target time is achievable.

The provider receives `store:false`, `stream:true`, array input and developer instructions via the public Responses endpoint. No automatic retry is performed. A completed event is mandatory; deltas, incomplete/error/refusal responses and invalid JSON are never saved as plans. When the completed envelope includes final assistant text, it must match accumulated text deltas. Some subscription transports omit completed output; accumulated text is accepted only after the completed terminal event. Missing Content-Type is tolerated only with correctly framed SSE; an explicit non-SSE content type is rejected. No raw prompt/provider error text is returned or persisted as an error.

Weather is a separate, explicitly requested reference. Today uses current weather; Schedule can look up an actual returned forecast for a chosen remaining session/time within coverage. Weather never silently edits the saved prescription. Missing sleep/recovery measurements remain unavailable. See [weather guidance](weather-training-adjustment.md).

## Persistence and concurrency

`training_generation_requests` records a durable per-user lease, bounded failure code, model and actual token usage when supplied. Billing source is `chatgpt_subscription`; `cost_usd` remains NULL because token counts do not establish a per-call dollar charge under a subscription. Provider plan/credit limits remain authoritative.

An advisory transaction lock plus a partial unique running-job index serializes generation for a user. Calls within 60 seconds and more than five attempts over a rolling 24 hours are rejected. Stale six-minute leases are recovered on a later attempt. Browser navigation does not imply a saved plan was lost: reopening polls the durable state. There is no automatic inference retry after a disconnect or ambiguous failure.

An input revision covers goals, dated conditions, activity/lap evidence, execution/feedback, applicable reviews, closeout state and version/date-dependent constraints. The revision is checked around the input read, at reservation and inside the final save. Changed inputs reject the save. The final RPC writes the plan, all workouts and successful job status in one transaction. Any failure rolls back every plan/workout write. A timeout may leave a successful committed result; the client reads the authoritative saved state rather than automatically generating again.

All API routes call the existing server-verified administrator allowlist. Mutation requests require matching Origin, JSON and a bounded streaming body; caller-supplied user IDs are not accepted. Plans and job history have owner-only reads; generation/completion RPCs are executable only by the service role. Browser tokens never obtain the service role. Cookie sessions, Proxy enforcement and additional administrator RLS restrictions are implemented; see [admin authentication](admin-session-proxy.md).

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

## Verification and private evidence

Automated unit tests use synthetic inputs; database integration tests use disposable accounts and fixed model responses. Live provider acceptance, when explicitly requested, is a separate check. Public documentation does not include real activity counts, measured weekly distances, target times or generated personal prescriptions. See [test boundaries and readiness](service-readiness.md).

## Evidence and limits

FIT lap labels are not automatically training classifications. Generic `interval` labels occur in easy auto-lap runs. Structured active/rest/warmup/cooldown blocks provide stronger evidence; overlapping, truncated and inconsistent lap totals are flagged and do not contribute to confirmed quality-work heuristics. Average session pace is not substituted for interval work pace.

The reference routine the user supplied is stored separately as `profiles.training_baseline`, with source `user_reported` and a report date. The generator can choose repetition structure using actual evidence and explain that choice. It does not require the user to specify each upcoming workout. Missing RPE, symptoms, sleep and recovery are not inferred from training effect or lap pace. Current-week activity matching is implemented separately; see the matching rules below.

References: [Garmin FIT activity/lap structure](https://developer.garmin.com/fit/articles/file-types/activity.html), [ACSM discussion of interval and recovery variables](https://acsm.org/high-intensity-interval-training-fitness/).

## Garmin completion matching

Today and Schedule now distinguish manual completion from verified Garmin activity matches.
See [matching rules, confirmation and reimport behavior](garmin-workout-matching.md).
Future generation prompts cover recovery/easy, tempo, interval and long-run purposes individually;
validation also rejects a tempo without sustained work and misordered warmup/cooldown.
