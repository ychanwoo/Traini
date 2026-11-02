# Weekly coaching cycle acceptance

This check follows the authenticated server's training timezone from the completed
Monday–Sunday review into the current week's plan. It complements the isolated
browser tests and the disposable-account database integration tests.

## Before running

1. Sync the watch with Garmin Connect and import the completed previous week.
   Also import the current week if it already contains activities. Missing
   activities remain unknown; the test never marks them as rest or skipped.
2. Confirm that goals and the current condition are accurate in Traini. Tests do
   not invent condition reports or acknowledge weekly closeout on the user's behalf.
3. Run `npm test`, the collector tests, `npm run lint`, `npm run build`, and
   `npm run test:e2e`. Start the built local service on port 3017.

On Monday, the previous week is calendar-complete and does not require an early
Sunday closeout acknowledgement. A Monday plan is checked for all seven dates,
including rest days. Later-week checks preserve the application's remaining-week
policy instead of fabricating prescriptions for past dates.

## Read-only acceptance

```sh
npm run test:weekly-cycle -- --browser
```

No generation requests are made by default. Missing reviews and plans are
reported as missing, not described as successful live generation. The temporary
administrator session is signed out after the check. Browser checks use a
disposable context and do not persist credentials or screenshots.

## Explicit live acceptance

```sh
npm run test:weekly-cycle -- --generate --browser
```

Run this only when live generation is intended and authorized. It can request
**one review and one plan**, sharing the normal rolling usage limit. Fresh results
are reused. The plan is read again after saving the review, because a new review
can invalidate an existing plan. A short server-reported cooldown is respected;
a longer limit, active job, or failed request stops the check without retries.
Cooldown timing uses the database's `checkedAt` value, so a fast local clock
cannot cause an early generation attempt. Usage limits are never reset or bypassed.

Acceptance checks cover:

- Previous-week source dates and current-week target dates in the server timezone.
- Every imported source activity's date, distance, and timer value in the review.
- The saved review ID, revision, and source week attached to the saved plan.
- Exactly seven distinct calendar dates for a Monday full-week plan.
- Independent distance, pace, step arithmetic, quality volume, available-day,
  race, condition, and demanding-session spacing checks.
- Preservation of other weeks and protected completed/skipped/feedback workouts.
- Matching plan data in Today and Schedule, actual/projected distance, and all
  seven schedule rows at 320, 375, 430, and 768 pixel viewport widths.

Only aggregate results are printed. Do not commit real activity data, raw model
responses, account identifiers, authentication material, or private test logs.
An acceptance pass confirms the tested inputs and execution path; it does not
guarantee athletic outcomes or provide medical clearance.

## Offline and database coverage

`tests/weekly-coaching-cycle.test.mjs` covers reuse, ordering, review invalidation,
single-attempt failures, quota/cooldown handling, incorrect linkage, missing or
duplicate dates, and fixture timestamps around DST/date-line zones without AI.

`npm run test:closeout:integration` and `npm run test:review:integration` use
disposable accounts and fixed model responses with the real database/service
path. The closeout test chooses next-week planning on Sunday and current-week
planning after rollover. Activity timestamps use local noon, so their training
dates satisfy the database constraint in every supported fixture timezone.
