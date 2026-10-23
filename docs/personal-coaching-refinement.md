# Personal coaching refinement

## Recent records

The web collector defaults to the current Monday through today on all days; the previous completed week remains selectable. CLI defaults are unchanged. Next selects fixed dates and Python independently allows today's selections or the previous day's selections for midnight handoff. Future/older arbitrary partial ranges remain invalid. Weekly review and closeout eligibility remain separate from importing.

Garmin management initially shows the current week, so a successfully imported recent activity is visible without switching the summary. Importing remains idempotent and retains original FITs. No authentication or database policy is relaxed.

## Readable coaching

Today replaces unavailable sleep/recovery cards with verified current-week distance and activity count. Missing distance is not fabricated; partial totals and the actual period are labelled. The cards share the authenticated progress read rather than adding separate metric requests.

Schedule is a compact, read-only weekly overview of dates, session titles, prescribed distances and target paces, with brief completion/skip indicators. Rest days show rest. Detailed purposes, steps, Garmin matching, weather, reviews and closeout stay on Today. Today also offers “지난 훈련 기록·수정”: choose the current or previous week and an earlier non-rest workout to record late feedback against its original workout ID. Future workouts cannot be edited through this form. Long purposes, weekly directions and coaching explanations have short previews and expandable complete text. Decimal paces/distances are not split as sentence boundaries; this is presentation, not a replacement AI evaluation. Historical symptom feedback, current condition, stale plans and conflicting prescriptions remain visible as distinct signals. Review evidence, plan reflection, feedback and original generated prose remain accessible.

Roadmap phase reasoning and recovery checks are grouped under details. Running analysis keeps core metrics and charts visible while moving calculation explanations into details. Existing colours, frame, navigation and typography are retained; no gradients are introduced.

## Refresh and identity

A progress provider lives under the verified AuthGuard identity. It shares the last successful data across app navigation without localStorage, browser persistence or a module-level account cache. Same-user session checks run without unmounting the page; identity changes, logout or failed authorization remove access to the provider. Server page, API and RLS checks remain in force.

Progress focus/timer reads are coalesced, not repeatedly aborted. Changes to goals, imports or plans during an active read queue a follow-up read. Same-day refresh failures retain labelled last-known data. Authorization denial clears it, and training-date rollover clears the old period before loading the new one. Initial loading is distinct from background refresh.

## Updating condition and plans

Use **마이 → 내 목표 및 대회 → 최근 컨디션**, or Today's **오늘 컨디션 확인·수정** link. Saving condition is a self-report and does not diagnose recovery or rewrite historical feedback. The existing explicit plan update action applies current inputs and preserves protected sessions; no view or background refresh calls inference.

## Verification

Run `npm test`, Python unittest, lint, typecheck and production build. The shared browser suite adds progress navigation/slow refresh/error recovery alongside existing review, feedback, closeout and responsive coverage. Fixture pages use synthetic data; actual Garmin collection, condition saving and an explicitly authorized plan generation are separate acceptance actions. Keep personal activity metrics, goals, prescriptions and credentials outside this document.
