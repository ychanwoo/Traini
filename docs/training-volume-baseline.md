# Habitual volume and interrupted weeks

## Purpose and scope

The planner distinguishes a habitual comparison from recent recorded workload.
A scheduling interruption should not automatically redefine habitual volume,
but neither a normal condition report nor an old high-volume week establishes
that the runner should immediately resume that load.

The pure calculation lives in `lib/training/volume-baseline.ts`. It makes no
network requests or writes. Existing saved plans, workout outcomes, activity
records, and the interface are unchanged. The new bounds apply when a plan is
subsequently generated; this change does not regenerate or rewrite saved plans.

## Evidence and missing data

Only the configured eight completed calendar weeks are considered. A closed
Sunday can enter that history through the existing closeout flow. Partial current
weeks remain separate and are accounted for by the existing remaining-week code.

A week is usable for volume when it has recorded activities, positive finite
distance, and distance measurements for every recorded activity. Pace coverage
is not required to calculate volume, although the planner's separate pace/history
checks still apply. This is **metric completeness**, not proof that every run was
uploaded. Missing activities and empty weeks remain unknown, not confirmed rest.

Dated evidence distinguishes:

- `symptom_report`: pain/discomfort, high fatigue, RPE at least 9, an adverse
  condition dated within the week, or a narrowly recognized interruption report.
  This is a self-report category, not an injury diagnosis.
- `schedule_report`: an explicit skipped outcome with a recognized scheduling
  reason, or a dated weekly memo explicitly linking missed running to scheduling.
- `unknown`: no supported reason. It must not be described as a healthy week.

Symptoms take precedence if both types are reported. Feedback from another week
or timezone does not explain this week's reduction. A current normal condition
does not erase historical symptoms or certify a return to previous capacity.

The memo matcher is deliberately narrow and deterministic. Examples include
`개인 일정 때문에 러닝하지 않았음`, `통증 때문에 장거리를 생략했어요`, and
`Skipped the run because of work`. Exact reasons such as `개인 일정` are accepted
only with a structured skipped outcome. A standalone weekly memo saying
`개인 일정`, a hypothetical/future statement, or a negated reason stays unknown.
It is not general natural-language understanding; unsupported wording must not
silently become a confirmed reason. No free-text instruction can override caps.

## Calculation

| Value | Definition |
| --- | --- |
| `habitualKm` | Median of the most recent four usable weeks without an explicit interruption, selected from up to eight completed weeks. Requires at least three such weeks; otherwise falls back to recent recorded volume. Unknown low weeks remain in the sample. |
| `recentKm` | Median of the most recent four usable recorded weeks, including interrupted weeks. |
| `loadReferenceKm` | The reference for current prescriptions. Normally habitual volume; bounded by recent actual work when symptoms or sustained reductions are present. |
| `ceilingKm` | A bounded full-week envelope before race, availability, and current-week accounting. It is not a target or mileage owed. |
| `minimumKm` | A lower planning bound; zero when recent symptoms or missing/ambiguous recent evidence make a full-volume requirement inappropriate. |

Two consecutive usable weeks below 80% of the habitual comparison are treated
as a sustained reduction for planning. With recent symptom reports, the return
anchor is the **latest** usable recent week, never a higher week before the
reduction. Otherwise, sustained reduction is bounded by the higher actual total
of the last two calendar weeks. Long-run evidence is restricted to those recent
weeks while returning, so an older long run cannot independently restore the cap.

The inherited 5% planning envelope is applied to recorded references. Recent
actual workload also caps the result. An interrupted latest week, recent symptom
report, unknown recent coverage, or unexplained large reduction prevents volume
progression above the habitual comparison. Historical gaps before the first
recorded week do not by themselves penalize a runner with limited history.

The 80% threshold, sample counts, and inherited 5% envelope are transparent
application heuristics—not physiological thresholds, medical clearance, or
validated guarantees of safe progression. Do not tune them merely to obtain a
preferred weekly distance. Heart-rate-based performance progression is a
separate follow-up.

## Integration and precedence

- `planPolicy` uses the selected reference for weekly, per-run, and quality-volume
  limits. It supplies `volumeBaseline` to the prompt and prescription preview.
- Prompt instructions distinguish habitual comparison, recent actual volume,
  interruption hints, and current bounds. Missing mileage is never added back.
- A weekly review may tighten limits; a progress recommendation cannot raise
  the minimum during a volume-progression hold.
- Current pain/illness restrictions, race taper/recovery, available weekdays,
  demanding-session spacing, and protected workouts continue to take precedence.
- Late-week planning retains proportional capacity and subtracts already-recorded
  distance once. It does not compress a whole week's load into remaining days.
- The same final policy is used for generation and validation. The historical
  review comparison (`baselineKm`) remains a descriptive comparison of prior
  weeks, not the current prescription ceiling or a second permission to increase it.
- User-reported routine and pace preferences remain inputs; reported weekly
  mileage or long-run distance cannot override measured volume/long-run evidence.

## Verification

```sh
node --test tests/training-volume-baseline.test.mjs
npm test
npm run lint
npm run build
npm run test:e2e
collector/.venv/bin/python -B -m unittest discover -s collector/tests -q
```

Synthetic tests cover consistent training, isolated scheduling loss, repeated
interruptions, symptoms with a newer normal condition, unknown low weeks,
incomplete coverage, absent records, limited history, exaggerated reported load,
ambiguous/negated memo text, timezone/date boundaries, Sunday/Monday continuity,
review/race precedence, protected dates, and late-week accounting.

`npm run audit:training-evidence` is an optional read-only source/DB/context check.
Do not run the live weekly-cycle generator just to test this calculation: it can
call AI and save plans. This implementation was verified without OpenAI calls or
personal-plan regeneration. Personal records and raw generated plans are not
included in the repository.
