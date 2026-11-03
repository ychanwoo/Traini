# Training evidence audit

## What this audit establishes

Traini already carries **activity-average and lap-average heart rate** into the
training-plan prompt. It does not yet compute heart-rate-based performance trends.
Availability, transport, and use in a prescription are separate questions.

The audit follows the current implementation using original local FIT files,
their normalized documents, owner-scoped database reads, the production training
context builder, and the production prompt serializer. It does not call OpenAI,
rewrite data, regenerate plans, or change the interface.

## Evidence map

| Measurement | FIT → normalized activity | Database | Plan input | Current deterministic use |
| --- | --- | --- | --- | --- |
| Distance | Session distance, meters | `activities.distance_meters` | Activity and weekly distance | Volume baseline, session and weekly limits |
| Timer duration | Session timer, seconds | `activities.duration_seconds` | `timerSeconds` | Pace and workload calculations |
| Elapsed duration | Session elapsed time | `activities.elapsed_time_seconds` | Not selected | No plan rule uses it |
| Moving duration | Nullable session moving time | `activities.moving_time_seconds` | Not selected | Not reconstructed from samples |
| Activity pace | Timer/distance; speed fallback when timer is unavailable | Seconds/km | Recomputed from paired timer/distance when possible | Pace bounds; whole-activity pace alone does not prove interval/tempo work |
| Activity average HR | `session.avg_heart_rate`, bpm | `activities.average_heart_rate` | `averageHeartRate` | Coverage checks; no comparative performance calculation |
| Activity cadence | Running strides/minute converted to steps/minute | `activities.average_cadence_steps_per_minute` | Not selected | No prescription rule |
| Lap distance, timer, pace, intensity | Separate in-memory decoder during upload | `activity_training_details.evidence.laps` | Per-lap measurements and derived work/recovery blocks | Structural interval/sustained classification and pace/repetition bounds |
| Lap average HR | Same separate evidence path | `evidence.laps[].averageHeartRate` | Preserved in raw lap evidence | Not included in derived work/recovery blocks or trend calculations |
| Aerobic/anaerobic training effect | Separate session evidence extraction | `activity_training_details.evidence` | Preserved | No deterministic prescription rule currently consumes it |
| Activity/lap maximum HR | Not exported | Not stored by this pipeline | Absent | None |
| Lap cadence | Not exported | Not stored by this pipeline | Absent | None |
| Time-series HR, speed, cadence | `record_mesgs` are deliberately excluded | Not stored | Absent | No drift, decoupling, or within-session trend calculation |

Lap evidence is **not inside the normalized activity JSON**. The uploader decodes
the original FIT separately and writes it with the activity through the import
RPC. Auditing only the normalized directory would incorrectly conclude that all
lap data had been lost.

The locally inspected source files contain time-series measurements and maximum
heart rates that this pipeline does not export. Session moving time was absent
in the inspected sample; that is a source limitation, not a failed DB transfer.
Availability may differ for other devices, recordings, or future activities.

## Plan input versus weekly review input

The plan serializer includes historical sessions, current-week sessions, raw lap
evidence, and `sessionAnalysis`. Activity IDs are removed from those sessions.
The current week remains separate from the eight completed historical weeks.

The weekly-review serializer sends review metrics and weekly history aggregates,
not those session arrays. Review metrics include distances, timer/pace values,
feedback, and summaries of active work. Weekly aggregates carry HR coverage
counts, **not the actual average or lap HR values**. The review therefore cannot
perform the same HR comparison that a reader might assume from the plan input.

Even for the plan, inclusion in a prompt is not evidence that a model used a
measurement correctly. This offline audit proves serialization and deterministic
behavior, not a model's reasoning or the suitability of a particular prescription.

## Confirmed limitations and follow-up priorities

### 1. Habitual volume and interrupted weeks

**Follow-up:** the baseline calculation described below records the original audit
finding. It has since been replaced by the separate habitual/recent-load logic in
[Habitual volume and interrupted weeks](training-volume-baseline.md).

The context contains eight weeks, but `planPolicy` takes the last four calendar
weeks with usable recorded distance/pace and computes their median. Ordinary
weekly capacity starts at 105% of that baseline before other restrictions.
Injury-interrupted and schedule-interrupted weeks are not separated from habitual
training weeks in this calculation. User-reported baseline is only a narrow
fallback when fewer than two usable recent weeks exist.

**Next:** distinguish habitual capacity, recent performed load, record coverage,
and documented interruption reasons. Preserve the fact that a missed session is
not mileage debt. Do not simply remove all low-volume weeks or raise the cap to
force a preferred distance.

### 2. Shared classification and performance evidence

`analyzeSession` recognizes `interval`, `sustained`, or `uncertain`; it is not a
complete recovery/easy/long-run classifier. It uses lap structure and relative
pace, not HR. Generic `interval` labels are not treated as proof of hard work.
Contiguous active laps can form one sustained block, while recoveries separate
interval repetitions.

The weekly-review `qualityEvidence` helper uses a separate algorithm: it requires
both warmup and cooldown labels and summarizes active laps without the same
contiguous-block classification. A synthetic sustained run without a cooldown
lap is recognized by the plan analyzer but omitted from review quality evidence.
This disagreement is reproduced, not changed, in this audit.

**Next:** align shared segment evidence before adding performance-based changes.
Compare like-for-like sessions and include coverage, dated subjective effort,
and relevant conditions. Raw HR availability alone must not establish improved
fitness, a threshold, recovery, or an appropriate increase in load.

### 3. Missing measurements and validation boundaries

- Missing session HR remains null even when record-level HR exists. No sample
  average is silently substituted for a session average.
- Lap elapsed/start/end values help validate continuity during decoding but are
  not exported. Pause warnings survive; timer-based recovery is not full elapsed
  recovery. Distance-based recovery remains the supported prescription format.
- The Python lap normalizer rejects HR outside 1–254 bpm. The TypeScript lap
  sanitizer currently allows zero, unlike activity HR validation. A synthetic
  characterization test documents this inconsistent lower bound. No such value
  was needed to explain the inspected real-data path.
- Maximum HR, lap cadence, and record-level measurements need an explicit schema,
  units, provenance, validation, and retention decision before use. Do not send
  entire FIT record streams or location/device data to a model by default.

## Reproduce the audit

Offline regression coverage, with synthetic measurements only:

```sh
node --test tests/training-evidence-audit.test.mjs
collector/.venv/bin/python -B -m unittest discover -s collector/tests -p test_evidence_audit.py -v
```

Read original files and the configured development database:

```sh
npm run audit:training-evidence
```

The command uses `.env.local` and the configured collector interpreter. The data
directory defaults to `~/Projects/Traini-data/garmin`; `TRAINI_AUDIT_DATA_DIR` can
override it. It uses direct read-only database access, not browser login or
endpoints that reconcile workout matches. Only SELECT/HEAD and the existing
stable `training_feedback_evidence` read RPC are allowed by its transport guard.

Original/normalized files are hashed before and after. Owner-scoped activity,
detail, profile, plan, review, and weekly-note snapshots are compared before and
after. Concurrent legitimate edits make the audit fail instead of reporting an
unchanged snapshot. Unsupported input/configuration fails without dumping raw
FIT data or database responses.

The Python bridge sends private values through an in-memory child-process pipe
for comparison. The public command prints only aggregate coverage, mismatch
counts, and validation flags. Do not invoke the bridge to save raw reports.
Do not commit personal source files, metrics, identifiers, or private logs.

The prompt check runs the real serializer with the base policy; it does not
execute the full generation service, reconciliation, or inference. It establishes
which evidence survives serialization, not an exact replay of a historical
request whose raw prompt was intentionally not retained.

## Verification outcome

The inspected originals matched normalized documents, stored activity metrics,
stored lap evidence, and source hashes. The inspected context preserved average
HR and lap measurements, and prompt serialization preserved those context values.
Source files and the audited DB snapshots were unchanged. No OpenAI calls were
made. Public results intentionally omit personal distances, paces, dates, and IDs.

Production parsing, database schema, training policy, saved plans, and UI remain
unchanged. The added tests characterize both preserved data and known gaps;
passing them does not mean the gaps have been fixed.

## Implementation references

- [Activity decoder](../collector/traini_collector/fit.py)
- [Lap decoder](../collector/traini_collector/intensity.py)
- [Uploader mapping and separate lap import](../collector/traini_collector/upload.py)
- [Context query](../lib/training/storage.ts) and [sanitizer](../lib/training/context.ts)
- [Plan policy and serializer](../lib/training/weekly-plan.ts)
- [Segment analyzer and prescription bounds](../lib/training/prescription.ts)
- [Review metrics and serializer](../lib/training/weekly-review.ts)
