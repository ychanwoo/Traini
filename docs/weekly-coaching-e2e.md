# Weekly coaching browser regression

The suite runs the production weekly running summary, Today plan, Schedule,
review card, feedback form, header and bottom navigation against a loopback-only
fixture server. It bundles their actual CSS and the production coaching-summary
builder. Platform adapters replace Next links/images/navigation and the browser
Supabase session only inside this separate test entry point.

## Run

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

Playwright starts and stops the fixture server on `127.0.0.1:3027`, uses one worker,
and does not automatically retry failed tests. The port must be free. Its eighteen
scenarios can also be executed through Codex's browser driver using the same
`coachingScenarios(tab, viewport)` implementation. Ordinary Node tests remain
available through `node --test tests/*.test.mjs`.

For manual inspection:

```sh
npm run test:e2e:serve
```

Open `http://127.0.0.1:3027/schedule` or `/today`. The clearly marked test controls
change fixture conditions or reset synthetic state. They are not included in
Traini's application routes or production bundle. Reloading retains fixture
writes in server memory; stopping/resetting the server discards them. This is
not a persistence or authentication implementation for the real service.

## Coverage

1. Imported running-summary reads, current/previous week selection, partial and
   empty records, refresh failure, retained last-known data and recovery.
2. Historical review selection, stored AI source text, exact review linkage and
   current/next plan navigation without inference requests.
3. Late feedback for its original workout date, RPE/fatigue/pain/memo persistence
   after refresh and Today/Schedule navigation, and safe rendering of memo text.
4. Required skip reasons, explicit skip status and preservation across refresh
   and navigation. Recording the skip does not generate a plan or review.
5. Failed reads, HTTP 401/403, malformed responses and first-load recovery.
   Existing review/plan content survives refresh failures.
6. Missing/partial data, outdated inputs, current symptom restrictions and slow
   initial reads. Unknown records do not imply rest, recovery or failed workouts.
7. Failed/conflicting feedback writes and a committed write with a lost response.
   Drafts remain, no mutation is automatically retried, unchanged explicit retries
   retain their operation ID, and subsequent reads reveal committed state.
8. Expanded feedback/review content at 320/375/430/768px, including long input.
   Frame/navigation bounds and horizontal overflow are checked.

9. Explicit Sunday closeout, reload persistence, Monday continuity of source dates,
   stale-data generation denial and acknowledgement updates without inference.

10. Progress data remains visible during slow and failed refreshes and app navigation.

11. Current-week import and previous-week selection work independently of review eligibility.

12. The production AuthGuard keeps the same-user view mounted during rechecks, hides it on failed verification, and recovers after a new successful check. Its provider/session adapter is synthetic; actual OAuth and RLS remain separate tests.

13. Current distance/count cards distinguish complete, partial, empty and retained-on-error data.

14. Roadmap preparation, taper and recovery details remain accessible at all supported frame widths.

15. Schedule remains a compact date/session/distance/target-pace overview; feedback stays on Today.

16. Today uses the production four-step composition, separates session recording from optional plan adjustment, labels initial creation by week, and disables pending generation. Explicit adjustment tests submit current/next payloads to a synthetic rejection endpoint and verify existing sessions are retained. No provider transport is available.

17. Weekly feedback stores RPE/memo against the selected week, survives reload, and stays separate when switching weeks. Today has no daily feedback controls. Full legacy feedback/review regression uses `/coaching-regression` with synthetic data.

18. Weekly note errors, conflicts and lost responses retain drafts; explicit retries reuse their request ID and do not call inference or write workout feedback.

Every scenario checks the fixture request ledger for unexpected APIs and verifies
that viewing data or saving feedback did not request AI generation. The fixture
process never loads `.env.local`, imports provider transports or connects to
Supabase/Garmin. Unknown API requests fail closed. A restrictive CSP blocks
external network requests; remote font imports are omitted in this offline
harness. Playwright also rejects unexpected external browser requests and page
exceptions. The test source intentionally uses synthetic records, not exports
from the administrator account.

## Boundaries and complementary checks

These are component browser workflow tests, not a replacement for the Next
server's routing, Google OAuth, Proxy, RLS or database transactions. Real server
and disposable-account checks remain separate:

```sh
npm run test:admin:integration
npm run test:feedback:integration
npm run test:review:integration
npm run lint
npx tsc --noEmit
npm run build
```

These integration scripts do not call OpenAI inference. They exercise actual
ownership, CSRF/authentication, version conflicts, save/reuse and database
preservation boundaries. They require the configured development database and,
for the administrator HTTP checks, the local app on port 3017. Do not confuse a
fixture session with evidence that real authentication passed.

## Regression fixed

Refreshing the weekly running summary previously replaced ready data with an
empty loading/error state. A failed refresh therefore removed the last verified
activities and totals. Refresh now retains that week's data and labels it as the
last confirmed result when an error occurs. Changing the selected week still
clears the old result, so a previous week's totals are not shown under a new
week. No layout, training prescription, saved user data or AI behavior changed.

On 2026-10-17, all nine shared scenarios passed in the Codex browser driver,
including the expanded mobile layouts; no browser console errors were observed.
The Playwright configuration discovers the same nine tests. All 294
Node tests and the actual administrator, feedback and review integration checks
also passed without inference calls. See the current check output for lint,
types and build results rather than treating this dated record as a future pass.

## Weekly feedback database validation

`node --env-file=.env.local scripts/test-weekly-feedback.mjs` uses a disposable account to verify week scoping, idempotency, version conflicts, review/plan invalidation and unchanged closeout acknowledgement. It does not write the administrator's data or call OpenAI. `supabase/tests/weekly_feedback.sql` checks service-only RPC access and RLS inside a rollback transaction.
