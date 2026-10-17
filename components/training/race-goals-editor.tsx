"use client";
import { Plus, Trash2 } from "lucide-react";
import {
  DISTANCES,
  formatTimeInput,
  timeText,
  type RaceGoal,
} from "@/lib/training/goal";
import styles from "./training.module.css";
export function RaceGoalsEditor({
  races,
  times,
  today,
  onChange,
  onTime,
}: {
  races: RaceGoal[];
  times: Record<string, string>;
  today: string;
  onChange: (races: RaceGoal[]) => void;
  onTime: (id: string, value: string) => void;
}) {
  const update = (id: string, patch: Partial<RaceGoal>) =>
    onChange(races.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <section className={styles.raceList} aria-label="대회 목표 목록">
      <p className={styles.note}>
        대회별 목표 기록을 등록하고 가장 중요한 대회 하나를 주목표로 선택해
        주세요. 다른 대회도 준비·회복 일정에 함께 반영해요.
      </p>
      {races.map((race, index) => (
        <fieldset key={race.id} className={styles.raceItem}>
          <legend>
            대회 {index + 1}
            {race.date && race.date < today ? " · 지난 대회" : ""}
          </legend>
          <div className={styles.heading}>
            <label className={styles.racePrimary}>
              <input
                type="radio"
                name="primary-race"
                checked={race.priority === "primary"}
                onChange={() =>
                  onChange(
                    races.map((r) => ({
                      ...r,
                      priority: r.id === race.id ? "primary" : "supporting",
                    })),
                  )
                }
              />
              주목표
            </label>
            <button
              type="button"
              aria-label={`대회 ${index + 1} 삭제`}
              onClick={() => {
                const remaining = races.filter((r) => r.id !== race.id);
                if (
                  remaining.length &&
                  !remaining.some((r) => r.priority === "primary")
                )
                  remaining[0] = { ...remaining[0], priority: "primary" };
                onChange(remaining);
              }}
            >
              <Trash2 aria-hidden="true" />
            </button>
          </div>
          <label className="settings-field">
            대회명
            <input
              aria-label={`대회 ${index + 1} 이름`}
              value={race.name}
              maxLength={120}
              placeholder="대회명 (선택)"
              onChange={(e) => update(race.id, { name: e.target.value })}
            />
          </label>
          <label className="settings-field">
            대회 날짜
            <input
              aria-label={`대회 ${index + 1} 날짜`}
              type="date"
              value={race.date}
              onChange={(e) => update(race.id, { date: e.target.value })}
            />
          </label>
          <label className={`settings-field ${styles.select}`}>
            거리
            <select
              aria-label={`대회 ${index + 1} 거리`}
              value={race.distance}
              onChange={(e) =>
                update(race.id, {
                  distance: e.target.value as RaceGoal["distance"],
                })
              }
            >
              {Object.keys(DISTANCES).map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            목표 기록 (선택)
            <input
              aria-label={`대회 ${index + 1} 목표 기록`}
              className="mono"
              inputMode="numeric"
              maxLength={8}
              value={times[race.id] ?? timeText(race.targetTimeSeconds)}
              placeholder="HH:MM:SS"
              onChange={(e) => onTime(race.id, formatTimeInput(e.target.value))}
            />
            <small className={styles.help}>
              완주가 목표라면 비워두세요. 목표 기록을 현재 훈련 능력으로
              간주하지 않아요.
            </small>
          </label>
        </fieldset>
      ))}
      <button
        type="button"
        className={styles.planAction}
        disabled={races.length >= 8}
        onClick={() =>
          onChange([
            ...races,
            {
              id: crypto.randomUUID(),
              name: "",
              distance: "HALF",
              date: "",
              targetTimeSeconds: null,
              priority: races.length ? "supporting" : "primary",
            },
          ])
        }
      >
        <Plus size={13} aria-hidden="true" /> 대회 추가
      </button>
      <p className={styles.help}>
        최대 8개 · 같은 날 두 대회는 등록할 수 없어요. 지난 대회는 회복 판단을
        위해 남겨둘 수 있어요.
      </p>
    </section>
  );
}
