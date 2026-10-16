"use client";
import styles from "./training-complete-button.module.css";
export function TrainingCompleteButton({
  completed,
  pending = false,
  onComplete,
}: {
  completed: boolean;
  pending?: boolean;
  onComplete: () => void;
}) {
  return (
    <button
      type="button"
      className={`primary-button mt-6 ${completed ? styles.completed : ""}`}
      disabled={completed || pending}
      aria-busy={pending}
      onClick={onComplete}
    >
      {completed ? "훈련 완료됨 ✓" : pending ? "저장 중…" : "오늘의 훈련 완료"}
    </button>
  );
}
