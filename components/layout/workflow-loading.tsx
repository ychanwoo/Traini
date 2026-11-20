"use client";

import { useId, useLayoutEffect, useRef } from "react";
import styles from "./workflow-loading.module.css";

export function WorkflowLoading({ title, detail }: { title: string; detail: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog ref={ref} className={styles.screen} aria-labelledby={id}
      aria-describedby={id + "-detail"} onCancel={event => event.preventDefault()}>
      <div className={styles.content}>
        <span className={styles.spinner} aria-hidden="true" />
        <h2 id={id}>{title}</h2>
        <p id={id + "-detail"} role="status">{detail}</p>
      </div>
    </dialog>
  );
}
