"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, Check } from "lucide-react";
import styles from "./training-complete-button.module.css";

export function TrainingCompleteButton({ completed, pending = false, onComplete }: {
  completed: boolean; pending?: boolean; onComplete: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; start: number; distance: number; limit: number } | null>(null);
  const locked = useRef(false);
  const [offset, setOffset] = useState(0);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const disabled = completed || pending;
  const [previousDisabled, setPreviousDisabled] = useState(disabled);
  if (previousDisabled !== disabled) {
    setPreviousDisabled(disabled);
    if (!disabled) setSubmitted(false);
    setDragging(false);
    setOffset(0);
    setProgress(0);
  }

  useEffect(() => {
    locked.current = completed || pending;
    gesture.current = null;
  }, [completed, pending]);

  function reset() {
    gesture.current = null;
    setDragging(false);
    setOffset(0);
    setProgress(0);
  }
  function finish() {
    if (disabled || locked.current) return;
    locked.current = true;
    setSubmitted(true);
    reset();
    onComplete();
  }

  return <div ref={track} className={`${styles.track} ${completed ? styles.completed : ""} ${dragging ? styles.active : ""}`} style={{ "--slide-progress": progress } as CSSProperties} aria-busy={pending}>
    <span className={styles.label} aria-live="polite">
      {completed && <Check className={submitted ? styles.checkEnter : undefined} size={16} aria-hidden="true" />}
      {completed ? "훈련 완료됨" : pending ? "저장 중…" : "밀어서 훈련 완료"}
    </span>
    <button
      type="button"
      className={`${styles.handle} ${dragging ? styles.dragging : ""} ${completed || submitted ? styles.atEnd : ""}`}
      style={{ width: completed || submitted ? "100%" : `calc(64px + ${offset}px)` }}
      disabled={disabled}
      aria-label={completed ? "훈련 완료됨" : pending ? "저장 중" : "오늘의 훈련 완료"}
      title="오른쪽 끝까지 밀어 완료 · 키보드는 Enter 또는 Space"
      onClick={event => { if (event.detail === 0) finish(); }}
      onPointerDown={event => {
        if (disabled || locked.current || !event.isPrimary || event.button !== 0) return;
        const limit = (track.current?.clientWidth ?? 0) - 64;
        if (limit <= 0) return;
        gesture.current = { id: event.pointerId, start: event.clientX, distance: 0, limit };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={event => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        current.distance = Math.min(current.limit, Math.max(0, event.clientX - current.start));
        setOffset(current.distance);
        setProgress(current.distance / current.limit);
      }}
      onPointerUp={event => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const releaseDistance = Math.max(0, event.clientX - current.start);
        const reachedEnd = releaseDistance >= current.limit - 8;
        reset();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (reachedEnd) finish();
      }}
      onPointerCancel={reset}
      onLostPointerCapture={reset}
      onKeyDown={event => { if (event.key === "Escape") reset(); }}
    >
      {!completed && <ArrowRight size={20} aria-hidden="true" />}
    </button>
  </div>;
}
