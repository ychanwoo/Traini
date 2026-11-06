import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={`rounded-[var(--radius-card)] border border-[#ECE8EF] bg-white p-4 ${className}`} {...props} />;
}
