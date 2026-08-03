"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export function AppTabHeader() {
  const router = useRouter();

  return (
    <header className="app-tab-header">
      <button aria-label="뒤로가기" onClick={() => router.back()}>
        <ChevronLeft />
      </button>
      <span className="app-tab-logo"><img src="/images/brand/traini-logo.png" alt="Traini" /></span>
      <span aria-hidden />
    </header>
  );
}
