# Weather-aware training guidance

Implements issue #30 using the existing `WEATHER_API_KEY`. No OpenAI calls, plan
regeneration, database migration, or stored workout changes are involved.

## User flow

- Today: the current session has a small weather reference card. The user explicitly
  requests current-location weather; location permission is not requested on load.
  Completed workouts receive no weather adjustment, and rest days have no running pace.
- Schedule: choose a remaining running session and a local training time, then request
  the nearest available forecast. The initial 07:00 is only a visible lookup default,
  not an inferred or persisted workout time. Timezone is the configured training
  timezone (`TRAINI_TIMEZONE`, default `America/Los_Angeles`).
- The original session pace, distance, repetitions and completion remain unchanged.
  Weather data is an adjacent reference, never silently baked into the stored plan.
- Location is rounded to two decimal places before transmission to the authenticated
  Traini API and OpenWeather. It is not saved in the profile, workouts, or browser
  storage. Refused, unsupported or timed-out location leaves the prescription intact.

## Provider, time and reliability

The key stays server-side. Current data uses `/data/2.5/weather`; forecasts use
`/data/2.5/forecast` with metric units. No One Call subscription or new paid endpoint
is activated. Existing-key access to both endpoints was checked against a public
city-centre fixture, without using personal GPS coordinates.

Provider `dt` is the current data calculation time or forecast valid time. `fetchedAt`
is the actual retrieval time, never substituted for the observation time. Forecast
issuance time is not supplied by this endpoint and is not invented. Forecasts use
only returned timestamps, at most 90 minutes from the requested time and inside
actual coverage. Past requests, forecast holes and dates beyond five days fail
without substituting current conditions. A weather reference is invalidated when
its requested training time passes.

Local dates and times are converted with the configured IANA timezone. Nonexistent
and ambiguous DST clock times are rejected rather than shifted silently. Invalid,
empty, duplicate, unknown or out-of-range query fields fail before upstream access.

A bounded 64-region, ten-minute memory cache coalesces identical in-flight requests
and shares forecast data across different target times in one region. Current and
forecast entries are separate; API key changes invalidate the cache. At most 64
unique requests can be in flight. Provider 429 responses pause new uncached queries
for a minute. Provider outages never cause stale observations to be served as fresh.
Current observations older than 90 minutes or more than five minutes ahead of the
clock are not used. The upstream timeout is eight seconds and payloads are capped
at 256 KiB. Optional missing wind/feels-like remain null; missing or invalid required
metrics fail validation. Errors never include upstream response bodies or keys.

All API responses, including errors and authorization denials, are private/no-store
with Cookie/Authorization Vary. The API independently verifies the administrator.
The UI aborts old requests, ignores obsolete geolocation callbacks, bounds location
and network waits, and rechecks displayed freshness every thirty seconds.

## Transparent reference rules

These are versioned product heuristics, **not a validated physiological pace model**.
They do not predict individual heat tolerance, physiological thresholds or safety.

- Heat bands: below 22°C: 0%; 22–24.9: 2%; 25–27.9: 4%; 28–29.9: 6%; 30+: 8%.
- Use the greater of the temperature/feels-like heat-band result and the actual
  temperature band plus 2% when temperature is at least 22°C and humidity at least
  70%. Do not add humidity a second time to a feels-like-based correction. Cap at 10%.
- Only easy and long runs with a valid original pace receive a slower reference pace.
  Seconds are rounded down so the reference never exceeds the percentage bound.
  Cold weather never speeds the prescribed pace up.
- Tempo and interval sessions retain their work/recovery paces. Guidance focuses on
  controlled effort and considering session duration/repetitions, without editing them.
- Sustained wind at least 5 m/s or gusts at least 10 m/s prompts effort guidance.
  Wind direction relative to the route is unknown, so no wind-derived seconds/km are invented.
- At 35°C heat/feels-like, -10°C air/feels-like, sustained wind 15 m/s, gusts 20 m/s,
  thunderstorm codes or specified hazardous precipitation/visibility codes, suppress
  numerical pace guidance and recommend reviewing timing/indoor alternatives and local conditions.
- Sun exposure, official alerts, surface conditions and individual recovery are not
  measured by this feature. Missing weather does not establish safe conditions and
  does not justify changing the saved plan.

Rules and the preserved original pace are implemented independently of provider
transport in `lib/weather/guidance.ts`. Supported conditions and data validity are
in `lib/weather/conditions.ts`; provider transport and caching are in
`lib/services/weather.ts`.

## Verification

```sh
npm run test:weather                 # offline, mocked provider only
node --test tests/*.test.mjs         # offline regression; no actual AI calls
collector/.venv/bin/python -m unittest discover -s collector/tests
npm run lint
npx tsc --noEmit
npm run build
npm run test:admin:integration       # local server and real auth/DB; no AI generation
npm run test:weather:provider        # opt-in real OpenWeather calls; no OpenAI
```

Tests cover source timestamps, freshness, forecast selection/coverage, DST and date
rollover, null/invalid metrics, bounded adjustments, session types, completion/rest,
provider failures, quota cooldown, cache expiry/eviction/coalescing/capacity and admin
access. Responsive layout is checked at 320, 375, 430 and 768px.

Manual end-to-end location check: open Schedule, select a future running session
inside the available forecast window, set the intended local time, press the weather
button and allow location if desired. Confirm the shown forecast timestamp and
unchanged original prescription. Browser permission settings are not modified by tests.

Sources: [current weather fields](https://openweathermap.org/api/current) and
[5-day / 3-hour forecast fields](https://openweathermap.org/api/forecast5).
