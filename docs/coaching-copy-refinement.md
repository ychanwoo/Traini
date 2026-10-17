# Evidence-grounded coaching feedback

The review card now leads with a concise assessment, its supporting context and
what is actually present in the saved current/next-week plans. It distinguishes
this evidence-based summary from the stored AI analysis, which remains available
in a collapsed details section. Viewing the summary makes no inference request.

## Data and wording boundaries

- `coaching-feedback.ts` derives the assessment from the selected week's verified metrics. Partial distances are not compared with a full-week baseline; missing activities are not interpreted as rest or failed training.
- Longest-run and active-block observations describe recorded evidence, not physiological thresholds or diagnoses. Dated pain/fatigue feedback is distinct from current effective condition.
- Current and next-week explanations read the saved workouts. They exclude completed/skipped sessions from pending mileage, identify missing dates and distinguish a stale, missing or unavailable plan from confirmed application.
- Review linkage requires both the saved review ID and its input revision. A recommendation or a matching date alone does not prove it was applied. The plan may reference a different historical review.
- Unresolved pain/illness takes precedence in the explanation. Remaining running under a symptom hold is flagged as a conflict; an all-rest schedule must actually exist before it is described as saved.
- A global input revision and consistent local dates guard the multi-query read. If current-state reads fail or change, weekly history remains available and plan application is explicitly unknown.
- The summary does not change training calculations, feedback, goals, workouts or reviews. It does not diagnose injury, decide recovery dates or promise a race result.

`coachingText` still makes legacy generated prose readable using a fixed allowlist
of Korean metric labels and appropriate particles. It retains numbers, dates and
units. User-authored race names, feedback memos and skip reasons stay untouched;
all text uses React's normal text escaping.

## AI analysis

Future review prompts request a short assessment first, distinct supporting
observations and a reasoned recommendation. Exact metric names belong only in
structured evidence arrays. The AI is instructed not to invent plan application:
current/next-week schedules are not part of its historical review input, so that
explanation comes from the saved-plan read above. The response schema, numerical
validation, quota and idempotent save behavior remain in force.

The main card can also summarize verified records before an AI review exists.
Its provenance is stated explicitly; it is not presented as a newly generated
ChatGPT response. Old AI source text is preserved for inspection.

## Verification

```sh
node --test tests/coaching-feedback.test.mjs tests/coaching-copy.test.mjs
node --test tests/*.test.mjs
npm run lint
npx tsc --noEmit
npm run build
```

Tests cover complete/partial/empty history, zero baselines, signed volume changes,
self-reports, protected sessions, ongoing pain, plan conflicts and missing dates,
review ID/revision mismatches, stale inputs, unavailable reads and mixed snapshots.
Rendering tests check readable copy, long text, HTML escaping, original memos,
empty/stale states and all recommendation directions, with effects/network disabled.

Inspect Today and Schedule, historical review selection, roadmap and running
analysis on mobile and desktop widths. Keep the existing 430px frame and styles;
verify wrapping, no horizontal overflow and no browser console errors.

For a separately authorized live test, start the server on port 3017 and choose
an explicit completed Monday if needed:

```sh
TRAINI_LIVE_AI_TEST=1 TRAINI_LIVE_REVIEW_START=YYYY-MM-DD npm run test:subscription:live
```

The opt-in test generates at most once, or reuses an unchanged fresh review. It
checks the saved result, coaching output and quota, and verifies existing plans
were not rewritten. It never forces regeneration, fabricates new inputs to bypass
reuse, or retries a provider failure automatically. Selecting a historical week
with no review can test the updated prompt while preserving the latest review and
its plans. Inspect the real response for clarity and factual grounding as well as
passing the schema; automated checks do not establish prose quality by themselves.
