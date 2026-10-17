# Personal training plan acceptance

Run after syncing the watch with Garmin Connect and completing collection,
parsing and upload. A successful import with no new activities can be correct:
an absence of new runs is not proof of rest, failed training or recovery.

```sh
npm run test:plan:acceptance
npm run test:prescription
node --test tests/*.test.mjs
collector/.venv/bin/python -m unittest discover -s collector/tests -q
npm run test:prescription:integration
npm run lint
npx tsc --noEmit
npm run build
```

The automated suites use synthetic data and disposable accounts; they do not
request OpenAI inference. The injury regression matrix tests fresh and old
pain/illness reports for both current and next weeks. It accepts rest-only
output, rejects every running session type, and confirms that a week rollover
does not automatically clear unresolved symptoms. It does not diagnose injury
or determine readiness to return to running.

## Inspect the real account without generating a plan

Start the local server on port 3017 with the configured administrator and run:

```sh
npm run test:plan:personal
```

This command creates an isolated administrator test session, sends GET requests,
and signs out that session. It does not send a login email, log out the browser,
save preferences, write feedback, reserve generation usage or call AI. Existing
plan reads may perform the application's normal activity matching. Snapshots
check that profile preferences, stored plan content and generation records are
unchanged. A revision change during the multi-query read stops the audit rather
than presenting a mixed snapshot as validated.

The audit verifies:

- Eight completed Monday–Sunday history weeks, separate from the incomplete current week.
- Independent race goals, timezone and effective condition shared by context and prescription APIs.
- Zero running and quality-session allowances for unresolved pain/illness.
- Saved session dates, availability, weekly/session distance, positive numerical values, recovery distances, repetition totals and demanding-session spacing.
- Existing prescription rules for each pending session, including interval and tempo evidence bounds.
- Historical, completed, skipped and feedback-bearing sessions remain protected rather than being reassigned as new training.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Both stored plans match current inputs and pass the audit. |
| 2 | A plan is missing or uses outdated inputs. Inspect `plans` and `issues`; this is an action-required result, not a passed prescription. |
| 1 | A request/assertion failed, inputs changed, or a supposedly fresh plan violates the audit. |

The report deliberately omits account identifiers, race names, target times,
activity IDs, authentication material and symptom details. Do not attach private
data directories or environment files to a public issue.

## Outdated plans and real generation

Updating condition invalidates plan inputs; it does not erase the saved plan or
rewrite completed sessions. Today and Schedule retain the existing records and
warn that the old prescription must be updated before being followed. A stale
long run is not approved simply because it remains visible.

If unresolved pain is reported, verify the zero-running envelope first. Do not
generate an ordinary running week to test provider connectivity. Record only
what the user actually reports; do not infer a diagnosis, its cause, a recovery
date, or clearance from days elapsed. No additional live generation is needed
to verify deterministic pain restrictions.

After current condition has been explicitly reviewed and inputs are ready,
inspect the intended week and quota, then explicitly generate once in the UI.
Check storage and re-run the audit before considering another attempt. Record
whether the saved result was reused or actually generated, and inspect provider
errors without automatically retrying or falling back to an API key. A successful
automated audit does not prove that an untested live provider response will pass.

If the user explicitly requests replacing both saved weeks while a symptom hold
is active, generate each intended week once through the existing protected save
path. Check its zero-running envelope first, retain completed/skipped/reported
sessions, respect the shared quota and cooldown, and read back both weeks after
the saves. A duplicate unchanged generation request must reuse the saved plan
without an additional inference reservation. Do not clear the user's condition
or fabricate a normal check-in merely to obtain a running plan.

The audit is an engineering acceptance check, not a clinical assessment or a
guarantee of training outcomes. Keep real-account evidence outside the repository.

## Review the explanation as well as the numbers

`blockedDates` combines several restrictions: symptoms, race-calendar rules,
protected sessions and already recorded activities. It does not establish that
an activity occurred on every blocked date. The generation input now provides
`policy.observedRunDates` separately for confirmed current-week activity dates;
next-week input has none. Symptom-related rest must be explained using the dated
condition, without inventing runs or interpreting missing activity as recovery.

Distance/pace validation cannot establish that every sentence is factually
grounded. Read the saved summary and daily reasons before accepting a live
result. Correct an unsupported explanation without another inference request,
preserving numerical prescription, protected sessions and generation usage.
