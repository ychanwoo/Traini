import { coachingLead } from "@/lib/training/coaching-presentation";
import { coachingText } from "@/lib/training/coaching-copy";
import styles from "./training.module.css";
export function CoachingDetail({
  text,
  label = "설명 자세히 보기",
  limit = 140,
}: {
  text: string;
  label?: string;
  limit?: number;
}) {
  const full = coachingText(text);
  const lead = coachingLead(full, limit);
  return (
    <>
      <p className={styles.note}>{lead}</p>
      {lead !== full.replace(/\s+/g, " ").trim() && (
        <details className={styles.details}>
          <summary>{label}</summary>
          <p className={styles.note}>{full}</p>
        </details>
      )}
    </>
  );
}
