# Personal service operation and recovery

Traini currently runs as a personal service on the configured Mac. The local Garmin collector and ChatGPT subscription credentials stay on that Mac. This issue does not make those components available on Vercel or guarantee a continuously running cloud server.

## Start and check

From the repository root:

```sh
npm install
npm run service:check
npm run dev -- --port 3017
```

For the production build, stop the development server before running:

```sh
npm run build
npm run start -- --port 3017
```

`service:check` prints only configuration readiness, local executable availability, the presence of the connected ChatGPT session, and database generation status. It does not print keys, tokens, email, FIT data or personal activity details. A connected credential record is not proof that the provider will authorize the next request. The command does not log in to Garmin, refresh ChatGPT credentials, reserve a generation or call inference.

The authenticated administrator can also open `/api/training/generation-status`. It exposes the shared plan/review rolling quota, cooldown and any active generation lease. Other users cannot read it. A status GET never starts/restarts a generation.

## Normal weekly workflow

1. Sync the Garmin watch with Garmin Connect.
2. In Traini, select **이번 주 가져오기** on Sunday, or **지난주 가져오기** on other days. The worker collects FITs, parses them, uploads verified normalized records and causes the summaries/matches to refresh. Review each stage's result; a partial import is not a complete week.
3. Record feedback or explicit skips in Today/Schedule, including late entries for their original training date.
4. After the week is complete, explicitly create/update its weekly review.
5. Inspect the review, then explicitly generate/update the intended training week. Feedback or importing alone does not call AI or replace the saved plan.

The web import card selects the current Monday–Sunday on local Sunday and the previous completed week otherwise. Sunday retains a previous-week toggle. The worker receives fixed source dates. After finishing Sunday training, explicitly acknowledge **주간 마감** before reviewing that current week; acknowledgement alone never calls AI. See [weekly closeout](weekly-training-closeout.md). See the collector README for an explicit date-range import when needed. Missing records are unknown, never proof of rest or missed training.

## Failure and recovery

| Situation | Behavior and next action |
| --- | --- |
| Expired Google/admin session | Requests stop with 401/403. Sign back in, inspect saved data, then submit only if needed. No automatic mutation retries. |
| Garmin auth required | Run `collector/.venv/bin/traini-collect --login` in your terminal and complete authentication yourself, then retry importing. |
| Partial download/parse/upload | Original FITs and successful database writes remain. Retry the same week; unchanged files and activities are reused rather than duplicated. |
| Import interrupted or server restarted | Reopen the Garmin page to read the detached worker's status. A missing/dead or over-time worker is shown as interrupted. An active worker's lock is never deleted to force a second import. |
| Slow status reads | One read per view is allowed to finish; polling/focus events do not continuously cancel it. Navigation and explicit mutations may abort a read. |
| Timeout, lost response or malformed server response | The UI retains previously loaded data and asks you to check saved state. A failed response does not prove rollback. No automatic POST retry. |
| Plan/review save response lost | Read the generation's database state. A completed request is read back without calling AI again. A duplicate completed save returns the already saved record without rewriting it. |
| Save outcome cannot be read | Leave the generation lease intact to avoid a second paid request. Inspect status after connectivity recovers. The six-minute lease expires; the next explicit reservation marks it interrupted and releases the slot. Expiry does not itself restart AI. |
| Input changed during inference | Compare-and-swap rejects the save. Existing plans/reviews survive; inspect changed goals, imports or feedback before explicitly trying again. |
| Provider 401/403/429 or incomplete output | Stop with reconnect/permission/limit/output error. Do not retry automatically, switch to an API key, change accounts or purchase credits. Existing stored content is retained. |
| Plan/review committed, follow-up GET failed | Do not mark the successful job failed. Reopen or refresh the screen to read the saved result. |

Plan completion, matching, preferences and generation commit share an owner lock. Plan and review commits acquire that owner lock before locking their generation row, avoiding a reversed lock order during simultaneous reservation/expiry and commit.

## Usage and billing boundary

Plan and review attempts share **five reservations over the previous 24 hours**, with a 60-second cooldown. Failures count because a lost response may already have consumed provider usage. A new calendar day does not reset this window. `quota.retryAt` describes the quota/cooldown; an active generation must also finish or expire. Reusing an unchanged saved plan/review does not reserve another request.

ChatGPT's provider-controlled subscription limit is separate. This app uses the existing subscription transport and has no paid API-key fallback or automatic inference retries. Keep credit usage and auto-recharge disabled in your ChatGPT account if you intend to use subscription allowance only; Traini does not change those account settings.

## Data boundaries

FIT originals: `~/Projects/Traini-data/garmin/activities/`. Parsed results and local checkpoints remain in that Garmin data directory. Auth material stays under `~/Library/Application Support/Traini/auth/`. Never attach auth files or `.env.local` to a GitHub issue or include them in public portfolio screenshots.

Do not remove original FITs, database plans, feedback, or active lock files as a troubleshooting shortcut. Database migrations are tracked under `supabase/migrations`; inspect pending migrations before applying them. A local server restart does not require deleting data or rerunning migrations.

## Verification

```sh
node --test tests/*.test.mjs
collector/.venv/bin/python -m unittest discover -s collector/tests -q
npm run test:reliability:integration
npm run test:prescription:integration
npm run test:review:integration
npm run test:feedback:integration
npm run test:admin:integration
npm run lint
npx tsc --noEmit
npm run build
```

Automated integration tests create disposable accounts and clean them up. The reliability test crosses synthetic FIT collection, the real Garmin decoder, real Supabase upload, repeated import, weekly totals, matching, feedback and review snapshot boundaries. Plan/review integration tests inject a lost response after a real commit, verify recovery, and replay the completed save RPC. Quota tests verify failed-attempt accounting, rolling expiry, cooldown, active-request denial and expired-lease recovery. Automated suites do not call OpenAI inference.

For a deliberately authorized live subscription test, with the local server running:

```sh
TRAINI_LIVE_AI_TEST=1 npm run test:subscription:live
```

This opt-in command authenticates an isolated local session, checks available quota, and makes at most one weekly-review generation POST. If a fresh review exists, it reuses it. It may save a validated real review, but verifies existing training-plan records are unchanged. It never automatically retries a provider failure. It is deliberately excluded from ordinary automated tests.

## Verified result for this change

On 2026-10-17: 265 Node tests, 103 Python tests, ESLint, TypeScript, and production build passed. Disposable-account database tests verified the synthetic FIT round trip, feedback, quota/lease behavior, and response-loss recovery for real plan/review commits. Live administrator/session/CSRF tests passed, including denial of direct non-service calls to the quota RPC. The existing 430px frame/navigation remained bounded at 320/375/430/768px, with no browser console errors observed.

One explicitly authorized live subscription generation produced and saved a validated weekly review. Existing training-plan records were verified unchanged. The final diagnostic reported one reservation used and four remaining in Traini's rolling window; this is a verification-time snapshot, not a promise about future availability or the provider's separate allowance. No further live generation attempts were made.
