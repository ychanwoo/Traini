# Weekly closeout and planning source

Traini uses Monday–Sunday calendar weeks in `TRAINI_TIMEZONE`. Sunday closeout
is an explicit acknowledgement that the user has finished training for that week;
it does not establish that every workout happened, that missing records mean
rest, or that symptoms resolved.

## Weekly workflow

- The web import card defaults to **이번 주 가져오기** on every day and shows
  Monday through today in the configured timezone. **지난주 기록 보기** selects
  the previous completed Monday–Sunday. The CLI default remains the previous
  completed week. Partial imports never imply that the week is closed.
- After syncing/importing and inspecting results, record feedback or explicit
  skips. In Today/Schedule, inspect **주간 마감**, including its source week,
  following planning week, recorded activities and unresolved stored sessions.
- Check the acknowledgement and press **주간 마감 확인**. This saves only a
  closeout record. It does not complete/skip workouts, change existing plans,
  create a review, reserve generation usage, or call AI.
- Sunday's closed week becomes available in the review picker. Generating its
  review remains a separate explicit action. Generating/updating the following
  week's plan remains another explicit action under the shared quota.
- On Monday, the same source dates become the ordinary completed previous week.
  Its saved review ID/revision can inform the now-current plan. Completed past
  weeks do not require a closeout acknowledgement before reviewing them.

The existing date-sensitive plan invalidation remains in force: a calendar
rollover can require checking an existing plan against current conditions and
race rules. A carried-over review is not a guarantee that a saved plan is still
current. No rollover or closeout automatically calls inference or clears a
symptom restriction.

## Consistency and source selection

`training_week_closeouts` stores the owner, source Monday, timezone, acknowledgement
fingerprint and timestamp. A same-fingerprint repeat keeps the existing timestamp.
The server verifies the currently eligible week using its own clock; the browser
cannot request future weeks, choose another user, or supply a trusted current date.

The worker receives the server-selected fixed start/end dates, not a request-built
shell command. Python independently validates the range. A fixed-date request started after local midnight retains the original dates;
the worker accepts only today's or the previous day's valid server selections.
Local Sunday/Monday, DST and year boundaries use calendar arithmetic.

Two fingerprints serve different purposes:

- The existing review revision retains the full evidence/provenance snapshot.
- The closeout revision excludes matching UI state/reason and snapshot-read date,
  which can change during ordinary reconciliation without changed execution.
  It retains actual activities, links, outcomes, feedback, training inputs and
  race goals. Reconciliation can make a review stale while the acknowledgement
  remains current; actual evidence changes invalidate both.

A late activity, changed goal or new/edited feedback can make the acknowledgement
outdated. On Sunday, the user must explicitly refresh it before generating a
review or a next-week plan. The generation path stops before reserving usage.
Once the week is calendar-complete, the regular explicit review-update path
remains available. Stored reviews and plans are retained with stale warnings.

For current-week planning, execution/review evidence remains the previous week.
For next-week planning after Sunday closeout, it uses the closed current week.
The eight-week history window then includes that closed week while retaining the
real current date for goals, condition freshness, symptoms and plan periods.
The planning prompt, validator and saved database review context use the same
selected review ID and input revision. There is no fallback to an unrelated older
review when the selected closed-week review is stale.

## Access and migrations

- `/api/training/closeout` requires the verified administrator and owner-scoped
  reads. POST also requires same-origin bounded JSON, exact fields, valid dates,
  a revision and an explicit confirmation.
- The table has RLS and only the administrator may select their own rows.
  Anonymous/authenticated clients cannot write it or execute closeout RPCs.
- Server mutations use the existing owner advisory lock and compare the current
  snapshot before saving. No activity, workout, feedback or plan content is
  rewritten by the closeout RPC.
- `20261019000000_weekly_training_closeout.sql` adds closeout storage, eligibility,
  Sunday snapshots and review/provenance selection.
- `20261019010000_stable_week_closeout_revisions.sql` separates acknowledgement
  from operational matching metadata while preserving historical review hashes.

The migrations were applied to the configured development Supabase project.
They add input-revision dependencies, so old plans can be marked outdated. This
preserves their contents and completed workouts; it does not regenerate them.

## Verification

```sh
npm run test:closeout
npm test
npm run typecheck
npm run lint
npm run build
collector/.venv/bin/python -m unittest discover -s collector/tests -q
npm run test:db:closeout
npm run test:closeout:integration
npm run test:review:integration
npm run test:prescription:integration
npm run test:feedback:integration
npm run test:admin:integration
npm run test:e2e
```

Ordinary Node/Python tests use synthetic data and no inference. The closeout
integration uses a disposable account and a server-validated Sunday timezone
when one is currently available; it does not override the database clock or
modify the administrator's timezone, goals, symptoms or plans. It injects fixed
model responses into the real validation/reservation/save path. Only that
fixture's completed reservation is aged to test a second generation after the
normal cooldown denial. Actual OpenAI inference calls remain zero. Fixture
records and account are removed afterwards.

Coverage includes Sunday/Monday in Los Angeles, Seoul and Kiritimati, DST/year
boundaries, unavailable future/partial imports, fixed worker dates, same-owner
repeats, missing/unconfirmed data, source review linkage, continuing pain,
late imports/feedback, stale-data denial before inference, RLS and CSRF.
The shared browser suite includes the Sunday confirmation, reload, Monday source
continuity, stale-state generation denial and explicit re-acknowledgement,
alongside existing feedback/error/mobile checks. See
[the browser test boundary](weekly-coaching-e2e.md) for the distinction between
fixture UI tests and actual Next/server/database integration.
