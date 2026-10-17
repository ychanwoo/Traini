"use client";
import { useEffect, useRef, useState } from "react";
import { Sun } from "lucide-react";
import {
  freshWeather,
  trainingInstant,
  parseWeatherSnapshot,
  weatherErrorMessage,
  type WeatherSnapshot,
} from "@/lib/weather/conditions";
import { weatherGuidance, type WeatherWorkout } from "@/lib/weather/guidance";
import type { StoredWorkout } from "@/lib/training/weekly-plan";
import styles from "./training-weather.module.css";
const pace = (seconds: number | null) =>
  seconds === null
    ? "강도 기준"
    : `${Math.floor(seconds / 60)}′${String(seconds % 60).padStart(2, "0")}″/km`;
export function TrainingWeatherCard({
  workout,
  timezone,
  target,
}: {
  workout: WeatherWorkout;
  timezone: string;
  target?: { date: string; time: string };
}) {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null),
    [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
      "idle",
    ),
    [error, setError] = useState<string | null>(null),
    [now, setNow] = useState(() => Date.now());
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      clearInterval(timer);
      controller.current?.abort();
    };
  }, []);
  const stale = !!weather && !freshWeather(weather, new Date(now));
  const guidance = weatherGuidance(
    workout,
    stale ? null : weather,
    new Date(now),
  );
  const busy = status === "loading";
  function load() {
    if (busy || workout.completed || workout.kind === "rest") return;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    const requestId = ++generation.current;
    setStatus("loading");
    setWeather(null);
    setError(null);
    const fail = (message: string) => {
      if (!c.signal.aborted && requestId === generation.current) {
        setError(message);
        setStatus("error");
      }
    };
    if (!navigator.geolocation) {
      fail(
        "이 브라우저에서는 위치를 확인할 수 없어요. 원래 훈련 처방을 유지해요.",
      );
      return;
    }
    if (target) {
      try {
        const instant = trainingInstant(
          target.date,
          target.time,
          timezone,
        ).getTime();
        if (instant <= Date.now() || instant > Date.now() + 5 * 86400000) {
          fail(weatherErrorMessage("weather_coverage"));
          return;
        }
      } catch {
        fail(weatherErrorMessage("weather_time"));
        return;
      }
    }
    const locationTimer = setTimeout(() => {
      fail("위치 확인 시간이 초과됐어요. 원래 훈련 처방을 유지해요.");
      c.abort();
    }, 10000);
    c.signal.addEventListener("abort", () => clearTimeout(locationTimer), {
      once: true,
    });
    try {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          clearTimeout(locationTimer);
          if (c.signal.aborted || requestId !== generation.current) return;
          try {
            const lat = (
                Math.round(position.coords.latitude * 100) / 100
              ).toFixed(2),
              lon = (Math.round(position.coords.longitude * 100) / 100).toFixed(
                2,
              );
            const query = new URLSearchParams({
              lat,
              lon,
              ...(target ? { date: target.date, time: target.time } : {}),
            });
            const r = await fetch(`/api/weather?${query}`, {
              cache: "no-store",
              signal: AbortSignal.any([c.signal, AbortSignal.timeout(15000)]),
            });
            const body = await r.json();
            if (!r.ok) throw new Error(weatherErrorMessage(body.code));
            const result = parseWeatherSnapshot(body);
            if (
              result.kind !== (target ? "forecast" : "current") ||
              !freshWeather(result) ||
              (target &&
                result.requestedFor !==
                  trainingInstant(
                    target.date,
                    target.time,
                    timezone,
                  ).toISOString())
            )
              throw new Error(weatherErrorMessage("weather_stale"));
            if (!c.signal.aborted && requestId === generation.current) {
              setWeather(result);
              setStatus("ready");
              setNow(Date.now());
            }
          } catch (e) {
            fail(
              (e instanceof Error && e.message.startsWith("날씨")) ||
                (e instanceof Error && e.message.startsWith("이 시간")) ||
                (e instanceof Error && e.message.startsWith("훈련 시간"))
                ? e.message
                : weatherErrorMessage("weather_provider"),
            );
          }
        },
        (e) => {
          clearTimeout(locationTimer);
          fail(
            e.code === 1
              ? "위치 사용이 허용되지 않았어요. 원래 훈련 처방을 유지해요."
              : "위치를 확인하지 못했어요. 다시 확인하거나 원래 훈련 처방을 참고해 주세요.",
          );
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
      );
    } catch {
      clearTimeout(locationTimer);
      fail("위치를 확인할 수 없어요. 원래 훈련 처방을 유지해요.");
    }
  }
  const time = (iso: string) =>
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: timezone,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  if (workout.completed || workout.kind === "rest")
    return (
      <div className={styles.card}>
        <p className={styles.note}>{guidance.reasons[0]}</p>
      </div>
    );
  return (
    <section
      className={styles.card}
      aria-label={target ? "훈련 시간대 날씨" : "현재 날씨 안내"}
      aria-busy={busy}
    >
      <div className={styles.heading}>
        <Sun size={16} aria-hidden="true" />
        <h3>{target ? "훈련 시간대 예보" : "현재 날씨 참고"}</h3>
      </div>
      <p className={styles.note}>
        {target
          ? `${target.date} ${target.time} · ${timezone}`
          : "지금 달리는 경우의 참고 정보예요. 다른 시간의 날씨를 뜻하지 않아요."}
      </p>
      <div aria-live="polite">
        {busy && <p className={styles.note}>위치와 날씨를 확인하고 있어요.</p>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {weather && !stale && (
          <>
            <p className={styles.conditions}>
              {weather.temperatureC.toFixed(1)}°C
              {weather.feelsLikeC !== null
                ? ` · 체감 ${weather.feelsLikeC.toFixed(1)}°C`
                : ""}
            </p>
            <p className={styles.note}>
              {weather.summary} · 습도 {weather.humidityPercent}% · 바람{" "}
              {weather.windMetersPerSecond === null
                ? "미확인"
                : `${weather.windMetersPerSecond.toFixed(1)}m/s`}
              {weather.gustMetersPerSecond !== null
                ? ` · 돌풍 ${weather.gustMetersPerSecond.toFixed(1)}m/s`
                : ""}
            </p>
            <p className={styles.meta}>
              OpenWeather · {target ? "3시간 간격 예보" : "관측"}{" "}
              {time(weather.validAt)}
              {target ? " · 가장 가까운 제공 시간대" : ""}
            </p>
            {guidance.status === "reference" && (
              <dl className={styles.paces}>
                <div>
                  <dt>원래 처방</dt>
                  <dd>{pace(workout.paceSecondsPerKm)}</dd>
                </div>
                <div>
                  <dt>날씨 참고 (+{guidance.slowdownPercent}%)</dt>
                  <dd>{pace(guidance.adjustedPace)}</dd>
                </div>
              </dl>
            )}
            <ul className={styles.reasons}>
              {guidance.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </>
        )}
        {stale && (
          <p className={styles.note}>{weatherErrorMessage("weather_stale")}</p>
        )}
      </div>
      <button
        type="button"
        className={styles.action}
        disabled={busy}
        onClick={load}
      >
        {busy
          ? "확인 중…"
          : weather || error
            ? "현재 위치로 다시 확인"
            : "현재 위치로 날씨 확인"}
      </button>
      <details className={styles.details}>
        <summary>보정 기준과 위치 사용</summary>
        <p>
          위치를 허용하면 소수점 둘째 자리로 반올림한 좌표를 Traini 서버와
          OpenWeather에 전송해요. 이동 중이거나 훈련 장소가 다르면 해당 장소에서
          다시 확인해 주세요.
        </p>
        <p>
          날씨 보정은 개인별 생리 반응을 예측하는 모델이 아닌 규칙 기반
          참고값이에요. 이지런·롱런에만 최대 10% 느린 페이스를 참고로 제시해요.
          바람의 진행 방향과 노면·일사량·공식 경보는 평가하지 않아요.
        </p>
        <p>
          원래 거리·반복 구성·저장된 페이스는 변경하지 않아요. 예보 범위 밖이나
          조회 실패 시 원래 처방을 유지해요.
        </p>
      </details>
    </section>
  );
}
export function ScheduleWeather({
  workouts,
  timezone,
  today,
}: {
  workouts: StoredWorkout[];
  timezone: string;
  today: string;
}) {
  const available = workouts.filter(
      (w) => !w.completed && w.kind !== "rest" && w.date >= today,
    ),
    [selected, setSelected] = useState(""),
    [time, setTime] = useState("07:00");
  const workout = available.find((w) => w.id === selected) ?? available[0];
  if (!workout) return null;
  return (
    <section className={styles.schedule} aria-label="훈련 날씨 확인">
      <div className={styles.controls}>
        <label>
          훈련일
          <select
            value={workout.id}
            onChange={(e) => setSelected(e.target.value)}
          >
            {available.map((w) => (
              <option value={w.id} key={w.id}>
                {w.date.slice(5).replace("-", ".")} · {w.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          확인할 훈련 시간
          <input
            type="time"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
      </div>
      <p className={styles.note}>
        훈련 시간은 예보 확인에만 사용해요. 기본 07:00은 저장된 훈련 시간이
        아니에요.
      </p>
      <TrainingWeatherCard
        key={`${workout.id}:${time}`}
        workout={workout}
        timezone={timezone}
        target={{ date: workout.date, time }}
      />
    </section>
  );
}
