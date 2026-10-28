# Training plan generation and validation

Plan generation uses the same final policy as the prescription preview. Importing activities or reading the preview does not generate a plan.

## Final policy

The server applies race policy, the applicable weekly review and evidence-based session bounds first. It then accounts for current-week activities and protects completed, skipped and previously reported sessions.

`finalizePlanPolicy` recalculates capacity after those dated restrictions. Daily capacity is rounded down to the supported 0.1 km increment; a day with less than 0.5 km capacity cannot contain a prescribed run. When no running capacity remains, the minimum and maximum distance become zero. Otherwise, the minimum cannot exceed feasible remaining capacity. Unconfirmed race recovery can still allow an all-rest plan.

This prevents a first plan generated after Sunday's final run from simultaneously requiring additional mileage and prohibiting every running date. It does not add missed mileage to another day or alter completed sessions.

## Response contract

Plans use strict structured output via `text.format`, following the [official OpenAI Structured Outputs format](https://developers.openai.com/api/docs/guides/structured-outputs). Schema constraints do not replace server validation: date order, weekly totals, step-distance sums, race restrictions, session spacing and evidence-dependent pace bounds are checked independently before storage.

- Step counts and numeric limits are shared by the schema, prompt and validator.
- Without measured tempo-pace evidence, the tempo workout and steady work-step paces must be null.
- Increasing interval repetitions requires a specified work pace no faster than the observed pace. With unknown work pace, repetitions cannot increase. Recovery and taper restrictions still apply.
- A supporting race date can remain in the required date array. Its zero-distance rest entry is a calendar placeholder; the race is a separate event, not a prescribed rest day or extra training mileage.
- Weekly RPE and notes are passed even when there is no applicable saved review. They remain dated, untrusted self-reports and do not prove daily completion or medical recovery.

## Failure diagnostics

The API retains `code: invalid_output` and returns an optional bounded `reason`. The generation request stores `invalid_output:<reason>` in its existing failure-code field. Examples include `json`, `step_count`, `weekly_distance`, `tempo_pace` and `interval_progression`. The existing user-facing error and prior saved plan are preserved.

Only allowlisted reason identifiers are persisted. Raw AI responses, prompts, feedback text and provider error messages are not logged. There is no automatic inference retry or API-key fallback; failed requests still follow the existing rolling generation allowance.

## Offline regression checks

```sh
node --test tests/training-plan-validation-conflicts.test.mjs
npm test
npm run lint
npm run typecheck
npm run build
```

The regression suite uses synthetic activities and mocked inference/storage. It covers first creation after a Sunday run, partial weeks, protected sessions, daily capacity rounding, DST, symptom holds, tempo uncertainty, interval progression, race placeholders, weekly notes, preview/generation agreement and failure preservation.

These checks do not call OpenAI or change personal records. Provider acceptance and the quality of a newly generated real plan require a separate explicitly initiated live check; passing offline checks does not guarantee that every future AI response will pass validation.
