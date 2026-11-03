# Performance-aware training

## What changes

Newly generated plans use comparable recorded sessions to refine their existing
prescription bounds. Saved plans, completed workouts, the database schema and the
interface are not rewritten. A successful offline test does not prove that a
particular training plan will achieve a race goal.

The plan and review now share `session-evidence.ts`. Consecutive active laps form
one sustained block; alternating work and recovery form repetitions. Whole-run
average pace and generic `interval` labels cannot establish tempo or interval
work. Work-block HR is timer-weighted and remains unknown if any contributing
lap lacks valid HR. Zero HR is normalized to null.

## Comparison and decisions

`performance-evidence.ts` compares up to eight weeks of observations, including
current-week sessions without turning that partial week into a volume baseline.
Reviews cut observations off at the reviewed week's end.

- At least four distinct training dates are needed: two older and two recent
  observations. The latest must be within 14 days.
- Distances must be similar. Intervals additionally require comparable repeat
  length, identical repetitions, comparable recovery distance and recovery pace.
  Paused recovery is not treated as known elapsed recovery.
- Faster work must recur, without materially shorter work, higher HR or higher
  dated session RPE, before optional pace progression is supported. Missing HR or
  RPE does not prove improvement, fatigue, normal condition or a need to cut volume.
- Increased reported/measured effort holds progression. Recent high weekly RPE
  can also hold progression, but is never assigned to an individual workout.
- Continuous running is grouped by recorded distance; it does not prove that the
  runner intended an easy, recovery or long workout. Prescription types retain
  their distinct existing effort and pace rules.

Numerical comparison tolerances are conservative product heuristics, not clinical
or physiological thresholds. Route, weather, sensor accuracy and running surface
are not controlled. HR alone never establishes fitness, zones or recovery.

## Enforcement

The performance evidence is included in both plan and review inputs. Plan bounds
are enforced by the existing response validator, not just prompt wording.

For comparable sessions, maintained/held work cannot be prescribed faster than
its recent reference. Supported improvement permits at most the existing small
pace allowance; weekly volume is capped at its reference, interval repetitions
are held, and recovery is not shortened or accelerated. Tempo work distance does
not increase alongside its performance-based pace adjustment. Recent execution
shortfalls, habitual/recent volume restrictions, symptoms, race taper/recovery,
remaining-week capacity and protected workouts remain authoritative.

The model still chooses a flexible schedule inside those bounds. A supported
trend is permission to consider a small adjustment, never an instruction to
increase every workout or compensate for missed training.

## Verification

```sh
node --test tests/performance-aware-training.test.mjs tests/training-evidence-audit.test.mjs
npm test
npm run lint
npm run build
npm run test:e2e
```

Tests use synthetic records and reject network access in the performance suite.
They cover stable/improving/conflicting effort, missing HR/RPE, weighted lap HR,
changed interval recovery, duplicate/stale observations, review date cutoffs,
condition precedence and rejection of prescriptions outside the new bounds.
No live OpenAI call or production-plan write is needed for these checks.
