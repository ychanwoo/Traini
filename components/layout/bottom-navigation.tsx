"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { navigationItems } from "@/constants/navigation";

export function BottomNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary navigation" className="border-t border-[#ECE8EF] bg-white px-2 pb-[max(12px,env(safe-area-inset-bottom))] pt-2">
      <ul className="grid grid-cols-4">
        {navigationItems.map((item) => {
          const active = pathname === item.href;

          return (
            <li key={item.href}>
              <Link
                className={`flex min-h-12 flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                  active ? "text-[#6B21A8]" : "text-[#857D8B]"
                }`}
                href={item.href}
              >
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${active ? "bg-[#6B21A8]" : "bg-[#D8D1DC]"}`} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
