"use client";
import { useProgress } from "@/components/training/use-progress";
import { distanceLabel } from "@/lib/garmin/running-summary";
import Link from "next/link";
export function CurrentRunningMetrics() {
  const { data, error } = useProgress();
  const current = data?.current;
  const count = current?.activityCount;
  const distance = count === 0 ? 0 : (current?.distanceMeters ?? null);
  return (
    <section className="mt-4" aria-label="이번 주 러닝 기록">
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="eyebrow">WEEKLY DISTANCE</p>
          <p className="mono mt-2 text-2xl font-semibold">
            {distanceLabel(distance)}
            <span className="ml-1 text-xs">km</span>
          </p>
          <p className="mt-2 text-[11px] text-[#756e7c]">
            이번 주 누적 거리
            {current && current.coverage.distanceCount < current.activityCount
              ? " · 부분 합계"
              : ""}
          </p>
        </div>
        <div className="card p-4">
          <p className="eyebrow">RUNS THIS WEEK</p>
          <p className="mono mt-2 text-2xl font-semibold">
            {count ?? "—"}
            <span className="ml-1 text-xs">회</span>
          </p>
          <p className="mt-2 text-[11px] text-[#756e7c]">수집된 러닝 활동</p>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-[#756e7c]">
        {current
          ? `${current.start} – ${data!.asOfDate} · ${data!.timezone}`
          : error
            ? "기록을 확인하지 못했어요."
            : "이번 주 기록 확인 중"}
        {data && error ? " · 갱신 실패, 마지막 확인 기록" : ""}
      </p>
      <Link
        className="mt-2 inline-block text-[11px] text-[#78558e]"
        href="/garmin-connect"
      >
        최신 러닝 가져오기
      </Link>
    </section>
  );
}
