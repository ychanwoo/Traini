"use client";

import Image from "next/image";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export function AppTabHeader() {
  const router = useRouter();

  return (
    <header className="app-tab-header">
      <button aria-label="뒤로가기" onClick={() => router.back()}>
        <ChevronLeft />
      </button>
      <span className="app-tab-logo"><Image src="/images/brand/traini-logo.png" alt="Traini" width={64} height={35} unoptimized /></span>
      <span aria-hidden />
    </header>
  );
}
