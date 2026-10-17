"use client";
import { useState } from "react";
import type { StoredWorkout } from "@/lib/training/weekly-plan";
import { matchReasonMessage } from "@/lib/training/workout-matching";
import styles from "./training.module.css";

export function WorkoutMatchDetails({
  workout,
  timezone,
  pending,
  onSave,
}: {
  workout: StoredWorkout;
  timezone: string;
  pending: boolean;
  onSave: (revision: string, ids: string[]) => void;
}) {
  const match = workout.matching;
  const [selected, setSelected] = useState<string[]>(
    () => match?.activities.filter((a) => a.linked).map((a) => a.id) ?? [],
  );
  if (!match || workout.kind === "rest") return null;
  const canSelect = match.activities.some((a) => a.selectable);
  const hasLink = match.activities.some((a) => a.linked);
  return (
    <details className={styles.matchDetails}>
      <summary>
        {match.state === "matched"
          ? "Garmin 기록 연결됨"
          : match.state === "review"
            ? "Garmin 기록 확인 필요"
            : match.state === "unavailable"
              ? "Garmin 연결 확인 지연"
              : "Garmin 기록 확인"}
      </summary>
      <p>{matchReasonMessage[match.reason]}</p>
      {match.actualDistanceKm !== null && (
        <p className={styles.matchActual}>
          실제 거리 {match.actualDistanceKm.toFixed(2)}km · 계획{" "}
          {workout.distanceKm.toFixed(1)}km
        </p>
      )}
      {match.activities.length > 0 && (
        <fieldset disabled={pending} className={styles.matchChoices}>
          <legend className="sr-only">이 훈련에 해당하는 러닝 기록 선택</legend>
          {match.activities.map((a) => (
            <label key={a.id}>
              <input
                type="checkbox"
                checked={selected.includes(a.id)}
                disabled={
                  !a.selectable ||
                  (!selected.includes(a.id) && selected.length >= 12)
                }
                onChange={(event) =>
                  setSelected((ids) =>
                    event.target.checked
                      ? [...ids, a.id]
                      : ids.filter((id) => id !== a.id),
                  )
                }
              />
              <span>
                {new Intl.DateTimeFormat("ko-KR", {
                  timeZone: timezone,
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }).format(new Date(a.startedAt))}
                {" · "}
                {a.distanceMeters === null
                  ? "거리 미수집"
                  : `${(a.distanceMeters / 1000).toFixed(2)}km`}
                {a.linked ? " · 연결됨" : ""}
                <small>
                  Garmin 활동 {a.garminId}
                  {!a.selectable ? " · 연결 불가" : ""}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {canSelect && (
        <>
          <p>
            여러 파일로 나눠 기록했다면 해당 기록을 함께 선택하세요. 선택한
            기록으로 이 훈련의 완료를 직접 확인합니다.
          </p>
          <button
            className={styles.matchAction}
            type="button"
            disabled={pending || !selected.length || selected.length > 12}
            onClick={() => onSave(match.revision, selected)}
          >
            선택한 기록으로 완료 확인
          </button>
        </>
      )}
      {hasLink && (
        <button
          className={styles.matchAction}
          type="button"
          disabled={pending}
          onClick={() => onSave(match.revision, [])}
        >
          기록 연결 해제
        </button>
      )}
      {workout.completed && match.source === "manual" && (
        <p>직접 표시한 완료 상태는 기록 연결과 별도로 유지돼요.</p>
      )}
    </details>
  );
}
