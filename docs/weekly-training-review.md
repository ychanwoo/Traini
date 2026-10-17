# Weekly training review

A review covers one Monday–Sunday week in `TRAINI_TIMEZONE` (default
`America/Los_Angeles`), normally selected among the last eight completed weeks.
On Sunday, the current week also becomes reviewable after explicit, current
closeout confirmation. See [weekly closeout](weekly-training-closeout.md).

## Data and evidence

`weekly_review_snapshot` reads the original plan, manual completion, revision-bound
Garmin matches and verified FIT activity metrics. A consistent historical training
context ends on the reviewed Sunday and includes that week plus the preceding
seven weeks. Reads are checked before and after context construction.

- No saved plan means unknown planned distance/adherence, never zero.
- Garmin-confirmed, manually completed, explicitly skipped and unconfirmed sessions
  remain separate. Missing activity does not establish a missed session or rest.
- Actual distance/time totals are separate from completed planned distance. Null
  metrics remain unknown; coverage counts identify partial totals. Pace uses only
  paired positive distance and timer measurements.
- Only recorded running on an explicitly planned rest day is labelled additional
  running. Other unmatched activities are unassigned, not automatically extra.
- Complete FIT active blocks contrasting with warmup/recovery/cooldown supply
  intensity evidence. Generic `interval` labels and whole-session average pace do
  not establish threshold or physiological intensity.
- Baseline volume is the median of up to four earlier recorded weeks with complete
  distance coverage. Empty weeks are not inserted as zero-volume weeks.

## AI and planning safeguards

The existing local ChatGPT subscription transport receives a strict JSON schema,
aggregate metrics, goals and weekly history. It receives no activity UUID, Garmin
activity ID, GPS, raw FIT, account contact details or credentials. A separate semantic
validator enforces exact keys, lengths, evidence names, required limitations and
bounded recommendations. It cannot validate every factual assertion in prose;
users should review the explanations. No sleep, HRV, weather, injury or recovery
assessment is inferred from absent data.

Reduction (at most 15%) is available only with at least two prior recorded weeks,
complete reviewed distance data and either volume >115% of the baseline or more
than two sessions with structured quality evidence. Progression (at most 5%) also
requires at least three prior weeks, three planned running sessions, all confirmed
by Garmin, and actual volume within 90–105% of baseline. Limited records alone do
not authorize reductions. Two quality sessions is an existing planning ceiling,
not a claim that two high-intensity sessions were measured.

Current-week planning uses a fresh review of the previous completed week.
Next-week planning after Sunday closeout uses the closed current week instead.
The selected source must be fresh; an unrelated older review is not substituted. `applyReviewPolicy` runs before subtracting current-week actual load;
it cannot raise existing volume, quality, long-run or race taper caps. Historical
reviews stay available for inspection. Generating a review does not overwrite a
plan. The existing explicit plan-generation/update action applies it, preserving
completed and past workouts. The plan stores the exact review context used, so a
later review update does not rewrite the plan's provenance.

## Storage, failure and access

Migration `20261016050000_weekly_training_reviews.sql` adds admin-only RLS storage,
service-only snapshot/reserve/finish RPCs, review provenance on plans and a request
kind discriminator. No existing Garmin or profile records are removed.

A fingerprint covers goals, reviewed plan/completion/matches and the historical
activity window. Time-dependent snapshot metadata is excluded. New unrelated
current-week activities do not stale an older review. Changed source data marks
a saved review stale; it remains readable but is excluded from new planning.

The owner advisory lock and six-minute generation lease are shared with plan
requests. The shared limit is one request per minute and five attempts in a rolling
24 hours, including failed attempts. Identical fresh input reuses its saved review
without calling the model. Save performs a final source comparison and atomically
upserts review + completes the job. Provider, validation or save failures retain
prior review and plan. No automatic retry, quota bypass or paid API fallback exists.

GET/POST `/api/training/review` require the administrator's server session. POST
requires a matching Origin and bounded JSON body; owner and timezone cannot be
supplied by the browser. Responses are private/no-store. UI reads are abortable,
ignore stale responses and poll active jobs; mobile frame dimensions stay unchanged.

## Verification

```sh
npm run test:review
npm run test:db:review
npm run test:review:integration
node --test tests/*.test.mjs
collector/.venv/bin/python -m unittest discover -s collector/tests
npm run lint
npx tsc --noEmit
npm run build
npm run test:admin:integration
```

The DB integration uses a disposable account and deterministic model fixture,
covering real context/matching/transactions, reuse, source changes and plan
provenance. It performs no actual model call. SQL tests use a rolled-back transaction
for ownership/RLS, reserve exclusion, shared limits, lease expiry, validation,
CAS rejection and existing-review preservation.

Manual check: open `/schedule`, inspect the last completed week's real metrics,
select an earlier week, generate a review when the shared quota permits, inspect
the observations/limitations, then explicitly update the desired plan. Actual provider acceptance is a separate opt-in check; do not call inference just to repeat deterministic validation. See [readiness](service-readiness.md).
