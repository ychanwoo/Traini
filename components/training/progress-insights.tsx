"use client";
import Link from "next/link";
import { useState } from "react";
import { CoachingDetail } from "./coaching-detail";
import { useProgress } from "./use-progress";
import { RefreshCw, ArrowRight } from "lucide-react";
import { distanceLabel, paceLabel } from "@/lib/garmin/running-summary";
import { timeText } from "@/lib/training/goal";
import type { ProgressInsights } from "@/lib/training/progress";
import { coachingCopy } from "@/lib/training/coaching-copy";
import styles from "./progress-insights.module.css";
const phases: Record<string, string> = {
  preparation: "대회 준비",
  taper: "테이퍼",
  race_day: "대회일",
  recovery: "회복·복귀 확인",
};
function Status({ state }: { state: ReturnType<typeof useProgress> }) {
  return (
    <>
      <button
        type="button"
        className={styles.refresh}
        aria-label="훈련 진행 데이터 새로고침"
        disabled={state.loading}
        onClick={() => void state.refresh()}
      >
        <RefreshCw aria-hidden="true" />
      </button>
      <div aria-live="polite">
        {state.loading && !state.data && (
          <p className={styles.note}>
            목표와 저장된 러닝 기록을 확인하고 있어요.
          </p>
        )}
        {state.error && (
          <p role="alert" className={styles.error}>
            {state.data ? "갱신하지 못했어요. 마지막으로 확인한 기록을 표시해요. " : ""}{state.error}
          </p>
        )}
      </div>
    </>
  );
}
function Metrics({ data }: { data: ProgressInsights }) {
  const t = data.totals;
  return (
    <dl className={styles.metrics}>
      <div>
        <dt>주간 평균 거리</dt>
        <dd>
          {distanceLabel(t.averageRecordedWeekMeters)}
          <small> km/주</small>
        </dd>
        <p>러닝 기록의 거리가 모두 확인된 {t.completeDistanceWeeks}주 기준</p>
      </div>
      <div>
        <dt>전체 평균 페이스</dt>
        <dd>
          {paceLabel(t.paceSecondsPerKm)}
          <small> /km</small>
        </dd>
        <p>거리·시간이 있는 러닝 {t.paceActivityCount}회</p>
      </div>
      <div>
        <dt>러닝 횟수</dt>
        <dd>
          {t.activityCount}
          <small> 회</small>
        </dd>
        <p>8주 중 기록 있는 주 {t.weeksWithActivities}주</p>
      </div>
      <div>
        <dt>최장 러닝</dt>
        <dd>
          {distanceLabel(t.longestRunMeters)}
          <small> km</small>
        </dd>
        <p>완료된 최근 8주 기준</p>
      </div>
    </dl>
  );
}
function WeeklyHistory({ data }: { data: ProgressInsights }) {
  const max = Math.max(1, ...data.weeks.map((w) => w.distanceMeters ?? 0));
  return (
    <section className={styles.card}>
      <h2>최근 8주 러닝 추이</h2>
      <p className={styles.note}>
        {data.period.start} – {data.period.end} · 완료된 월–일
      </p>
      <div className={styles.chart} aria-label="주간 기록 거리 비교">
        {data.weeks.map((w) => (
          <div key={w.start}>
            <span>{distanceLabel(w.distanceMeters)}</span>
            <div className={styles.track}>
              <i
                className={w.status === "partial_metrics" ? styles.partial : ""}
                style={{
                  height:
                    w.distanceMeters === null
                      ? 0
                      : `${(w.distanceMeters / max) * 100}%`,
                }}
              />
            </div>
            <small>{w.start.slice(5).replace("-", "/")}</small>
          </div>
        ))}
      </div>
      <p className={styles.note}>
        기록이 없는 주는 실제로 쉬었거나 0km를 달린 주로 판단하지 않아요. 거리
        일부가 누락된 주는 확인된 거리만 합산해요.
      </p>
      <details className={styles.details}>
        <summary>주별 거리·페이스·최장 거리</summary>
        <ul className={styles.list}>
          {data.weeks.map((w) => (
            <li key={w.start}>
              <strong>
                {w.start} – {w.end}
              </strong>
              <p>
                {w.activityCount
                  ? `${w.activityCount}회 · ${distanceLabel(w.distanceMeters)}km · ${paceLabel(w.paceSecondsPerKm)}/km · 최장 ${distanceLabel(w.longestRunMeters)}km`
                  : "저장된 러닝 기록 없음"}
              </p>
              {w.status === "partial_metrics" && (
                <p>
                  일부 측정값 누락 · 거리 {w.coverage.distanceCount}/
                  {w.activityCount} · 시간 {w.coverage.timerCount}/
                  {w.activityCount}
                </p>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
function Performance({ data }: { data: ProgressInsights }) {
  const p = data.current.performance;
  return (
    <section className={styles.card}>
      <h2>계획과 실제 수행</h2>
      <p className={styles.note}>
        이번 주 {data.current.start} – {data.current.end} · {data.asOfDate}까지
        수집된 기록
      </p>
      <dl className={styles.metrics}>
        <div>
          <dt>이번 주 계획 거리</dt>
          <dd>
            {p ? Number(p.plannedKm.toFixed(1)) : "—"}
            <small> km</small>
          </dd>
        </div>
        <div>
          <dt>실제 기록 거리</dt>
          <dd>
            {distanceLabel(data.current.distanceMeters)}
            <small> km</small>
          </dd>
        </div>
      </dl>
      {data.current.status === "partial_metrics" && (
        <p className={styles.note}>
          실제 거리·시간 일부가 누락돼 확인된 값만 표시해요.
        </p>
      )}
      {p ? (
        <>
          <p className={styles.note}>
            Garmin 확인 {p.garminCompleted}개 · 직접 완료 표시{" "}
            {p.manualCompleted}개 · 수행 미확인 {p.unconfirmed}개
            {p.unavailable ? ` · 연결 조회 불가 ${p.unavailable}개` : ""}
          </p>
          <p className={styles.note}>
            오늘까지 예정된 훈련 {p.dueSessions}개 · 이후 예정{" "}
            {p.upcomingSessions}개
          </p>
          {p.inputsChanged && (
            <p className={styles.note}>
              저장된 계획 이후 입력이 바뀌었어요. 일정 화면에서 확인해 주세요.
            </p>
          )}
        </>
      ) : (
        <p className={styles.note}>
          이번 주 저장된 계획이 없어 계획 대비 수행을 계산하지 않아요.
        </p>
      )}
      <CoachingDetail text={coachingCopy.manualCompletion} label="계획 거리와 실제 기록의 차이" />
      <details className={styles.details}>
        <summary>완료된 8주 계획 대비 수행</summary>
        <ul className={styles.list}>
          {data.weeks.map((w) => (
            <li key={w.start}>
              <strong>
                {w.start} – {w.end}
              </strong>
              <p>
                실제 기록 {distanceLabel(w.distanceMeters)}km
                {w.status === "partial_metrics" ? " · 측정값 일부 누락" : ""}
              </p>
              {w.performance.hasPlan ? (
                <>
                  <p>
                    계획 {w.performance.plannedKm}km ·{" "}
                    {w.performance.plannedSessions}개
                  </p>
                  <p>
                    Garmin 확인 {w.performance.garminCompleted} · 직접 완료 표시{" "}
                    {w.performance.manualCompleted} · 수행 미확인{" "}
                    {w.performance.unconfirmed} · 직접 건너뜀{" "}
                    {w.performance.explicitlySkipped}
                  </p>
                  <p>
                    계획과 연결된 러닝 {w.performance.matchedActualKm}km ·
                    연결되지 않은 러닝 {w.performance.unassignedRuns}회
                  </p>
                </>
              ) : (
                <p>저장된 계획 없음 · 수행률 계산 안 함</p>
              )}
            </li>
          ))}
        </ul>
      </details>
      <Link href="/schedule" className={styles.link}>
        일정에서 훈련 확인 <ArrowRight aria-hidden="true" />
      </Link>
    </section>
  );
}
export function RunningProgressAnalysis() {
  const state = useProgress(),
    data = state.data;
  return (
    <main className={styles.page}>
      <div className={styles.title}>
        <div>
          <p className="eyebrow">RUNNING INSIGHTS</p>
          <h1>나의 러닝 기록</h1>
        </div>
        <Status state={state} />
      </div>
      {data && (
        <>
          <section className={styles.card}>
            <h2>최근 8주 기록 요약</h2>
            <p className={styles.note}>
              {data.period.start} – {data.period.end} · {data.timezone}
            </p>
            {!data.totals.activityCount && (
              <p className={styles.note}>
                검증된 러닝 기록이 없어요. Garmin 기록을 가져온 뒤 다시 확인해
                주세요.
              </p>
            )}
            <Metrics data={data} />
            <p className={styles.note}>
              주간 평균은 기록과 거리가 모두 확인된 주만 계산하며, 훈련 목표나
              권장 거리가 아니에요.
            </p>
          </section>
          <WeeklyHistory data={data} />
          <Performance data={data} />
          <details className={`${styles.card} ${styles.details}`}>
            <summary>기록을 읽는 기준·누락 지표</summary>
            <p className={styles.note}>
              {data.comparison
                ? `직전 두 완료 주의 기록 거리 변화는 ${data.comparison.distanceChangePercent.toFixed(1)}%예요. 기록된 거리의 차이이며, 체력 향상·저하나 적정 부하 판정은 아니에요.`
                : "직전 두 완료 주의 거리 기록이 충분하지 않아 증감률을 표시하지 않아요."}
            </p>
            <p className={styles.note}>
              평균 페이스는 같은 러닝에서 확인된 총 타이머 시간 ÷ 총 거리로
              계산해요. 날씨·코스·세션 구성 차이가 있어 주간 페이스를 실력
              변화로 단정하지 않아요.
            </p>
            <p className={styles.note}>
              수면·HRV·회복 점수와 예상 완주 기록은 계산하지 않아요.
              {data.totals.missingDistanceCount || data.totals.missingTimerCount
                ? ` 거리 누락 ${data.totals.missingDistanceCount}회 · 시간 누락 ${data.totals.missingTimerCount}회.`
                : ""}
              {data.totals.excludedUnverifiedActivities
                ? ` 검증되지 않은 활동 ${data.totals.excludedUnverifiedActivities}회 제외.`
                : ""}
            </p>
          </details>
          <Link href="/my/goals" className={styles.link}>
            목표 및 대회 설정 <ArrowRight aria-hidden="true" />
          </Link>
        </>
      )}
    </main>
  );
}
export function TrainingRoadmap() {
  const state = useProgress(),
    [selected, setSelected] = useState(""),
    data = state.data;
  const race =
    data?.races.find((r) => r.id === selected) ??
    data?.races.find((r) => r.priority === "primary" && r.daysUntil >= 0) ??
    data?.races.find((r) => r.daysUntil >= 0) ??
    data?.races.at(-1);
  return (
    <main className={styles.page}>
      <div className={styles.title}>
        <div>
          <p className="eyebrow">TRAINING ROADMAP</p>
          <h1>나의 훈련 로드맵</h1>
        </div>
        <Status state={state} />
      </div>
      {data && (
        <>
          {race ? (
            <>
              <label className={styles.select}>
                대회 선택
                <select
                  value={race.id}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {data.races.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name || r.distance} · {r.date} ·{" "}
                      {r.priority === "primary" ? "주목표" : "준비 대회"}
                    </option>
                  ))}
                </select>
              </label>
              <section className={styles.card}>
                <p className="eyebrow">
                  {race.date} · {race.distance} ·{" "}
                  {race.daysUntil === 0
                    ? "D-DAY"
                    : race.daysUntil > 0
                      ? `D-${race.daysUntil}`
                      : `대회일 ${-race.daysUntil}일 경과`}
                </p>
                <h2>{race.name || "나의 목표 대회"}</h2>
                <dl className={styles.metrics}>
                  <div>
                    <dt>목표 기록</dt>
                    <dd>{timeText(race.targetTimeSeconds) || "완주 목표"}</dd>
                  </div>
                  <div>
                    <dt>목표 평균 페이스</dt>
                    <dd>
                      {paceLabel(race.targetPaceSecondsPerKm)}
                      <small> /km</small>
                    </dd>
                  </div>
                </dl>
                <p className={styles.note}>
                  목표 기록은 현재 실력이나 예상 완주 기록이 아니에요.
                </p>
              </section>
              <section className={styles.card}>
                <p className="eyebrow">{phases[race.phase]}</p>
                <h2>
                  {race.phase === "preparation"
                    ? "실제 기록에 맞춰 다음 한 주를 준비해요."
                    : race.phase === "taper"
                      ? "훈련량을 줄이며 익숙한 자극을 조절하는 시기예요."
                      : race.phase === "recovery"
                        ? !race.affectsCurrentPlan &&
                          race.recoveryState === "needs_check_in"
                          ? "과거 대회의 현재 회복 상태는 평가하지 않아요."
                          : race.recoveryState === "needs_check_in"
                            ? "복귀 전 상태와 러닝 기록을 확인해 주세요."
                            : "회복과 단계적인 복귀를 확인하는 시기예요."
                        : race.phase === "race_day"
                          ? "등록한 대회일이에요."
                          : "대회 날짜가 지난 목표예요."}
                </h2>
                <details className={styles.details}><summary>단계 적용 이유·회복 확인 기준</summary>
                <p className={styles.note}>
                  거리·대회 중요도·최근 훈련량·입력한 컨디션으로 조정한 계획
                  기준이에요. 날짜가 지났다고 회복 완료나 준비도 충족으로
                  판정하지 않아요.
                </p>
                <p className={styles.note}>
                  테이퍼 {race.taperDays}일 · 회복 확인 기준 {race.recoveryDays}
                  일. 테이퍼에도 근거 있는 짧은 자극 훈련은 허용하고, 마지막
                  이틀과 피로·통증 상태는 별도로 제한해요.
                </p>
                {race.phase === "recovery" && (
                  <p className={styles.note}>
                    {!race.affectsCurrentPlan &&
                    race.recoveryState === "needs_check_in"
                      ? "현재 평가 범위 밖의 과거 대회예요. 현재 훈련은 최근 기록과 컨디션을 기준으로 확인하며, 이 대회의 회복 완료를 판정하지 않아요."
                      : race.recoveryState === "needs_check_in"
                        ? "기준일 이후의 보통·좋음 컨디션 입력과 부담이 작은 복귀 러닝 2일 이상을 확인하기 전에는 고강도·장거리 배치를 보류해요."
                        : race.recoveryState === "gradual_return"
                          ? "컨디션 확인 입력과 복귀 러닝이 있어 단계적 복귀 범위예요. 회복 완료를 의미하지 않아요."
                          : race.recoveryState === "return_recorded"
                            ? "컨디션 확인 입력과 복귀 주간 기록이 있어요. 의학적 회복 완료 판정은 아니에요."
                            : "초기 회복 확인 기간이에요. 날짜가 지나면 자동으로 정상 훈련으로 돌아가지 않아요."}
                  </p>
                )}
                {race.phase === "recovery" &&
                  race.participation === "unconfirmed" && (
                    <p className={styles.note}>
                      대회일의 충분한 거리·시간 기록이 없어 실제 참가·완주
                      여부는 확인되지 않았어요.
                    </p>
                  )}
                </details>
                <ol className={styles.timeline}>
                  {[
                    {
                      label: "대회 준비",
                      date: `테이퍼 시작 전 · ${race.taperStart}부터 테이퍼`,
                      key: "preparation",
                    },
                    {
                      label: "테이퍼",
                      date: `${race.taperStart} – ${race.taperEnd}`,
                      key: "taper",
                    },
                    { label: "대회", date: race.date, key: "race_day" },
                    {
                      label: "회복·복귀 확인",
                      date: `${race.recoveryStart}부터 · ${race.recoveryEnd} 이후 상태 재확인`,
                      key: "recovery",
                    },
                  ].map((s) => (
                    <li
                      key={s.key}
                      aria-current={race.phase === s.key ? "step" : undefined}
                    >
                      <span />
                      <div>
                        <p>{s.date}</p>
                        <h3>{s.label}</h3>
                        {race.phase === s.key && (
                          <small>현재 표시 단계 · 완료 판정 아님</small>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
                <p className={styles.note}>
                  대회 당일은 별도 일정으로 표시하며, 추가 훈련을 뜻하지 않아요.
                  회복 기간은 의학적 회복 완료 예측이 아니에요.
                </p>
              </section>
            </>
          ) : (
            <section className={styles.card}>
              <h2>등록된 대회가 없어요.</h2>
              <p className={styles.note}>
                목표 대회의 날짜·거리·기록을 설정하면 대회별 일정을 확인할 수
                있어요.
              </p>
            </section>
          )}
          {data.races
            .filter(
              (r) =>
                r.id !== race?.id &&
                r.affectsCurrentPlan &&
                ["taper", "recovery", "race_day"].includes(r.phase),
            )
            .map((r) => (
              <p className={styles.note} key={r.id}>
                {r.name || r.distance} · {phases[r.phase]}도 함께 적용되는
                시기예요.
              </p>
            ))}
          {data.raceWarnings.map((w) => (
            <p key={w} className={styles.error}>
              {w}
            </p>
          ))}
          <Link href="/my/goals" className={styles.link}>
            여러 대회 목표 관리 <ArrowRight aria-hidden="true" />
          </Link>
          <section className={styles.card}>
            <h2>실제 기록으로 보는 준비 현황</h2>
            <Metrics data={data} />
            <p className={styles.note}>
              실제 훈련 거리·페이스는 현재 컨디션을 반영한 주간 계획에서 확인해 주세요.
            </p>
            <Link href="/schedule" className={styles.link}>
              이번 주 훈련 보기 <ArrowRight aria-hidden="true" />
            </Link>
            <Link href="/running-analysis" className={styles.link}>
              러닝 기록 분석 <ArrowRight aria-hidden="true" />
            </Link>
          </section>
        </>
      )}
    </main>
  );
}
export function MyProgressSummary() {
  const state = useProgress(),
    d = state.data;
  return (
    <section className={styles.card} aria-label="내 실제 훈련 요약">
      <div className={styles.title}>
        <h2>최근 8주 훈련 인사이트</h2>
        <Status state={state} />
      </div>
      {d && (
        <>
          <p className={styles.note}>
            {d.races.find((r) => r.priority === "primary")?.name ||
              "대회 목표는 내 목표 및 대회에서 확인해 주세요."}
          </p>
          <Metrics data={d} />
          <p className={styles.note}>
            여러 종류의 러닝을 합친 평균이며, 권장 훈련 페이스가 아니에요.
          </p>
          <Link className={styles.link} href="/running-analysis">
            러닝 기록 자세히 보기 <ArrowRight aria-hidden="true" />
          </Link>
        </>
      )}
    </section>
  );
}
