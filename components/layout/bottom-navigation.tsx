"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Footprints, Route, UserRound } from "lucide-react";
const items = [
  { href: "/today", label: "오늘", Icon: Footprints },
  { href: "/schedule", label: "일정", Icon: CalendarDays },
  { href: "/roadmap", label: "로드맵", Icon: Route },
  { href: "/my", label: "마이", Icon: UserRound },
];
export function BottomNavigation() {
  const pathname = usePathname();
  // Account, goal and Garmin setup pages belong to My in the four-tab shell.
  const active =
    pathname === "/today" || pathname === "/schedule" || pathname === "/roadmap"
      ? pathname
      : "/my";
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {items.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          className={active === href ? "active" : undefined}
          aria-current={active === href ? "page" : undefined}
        >
          <Icon aria-hidden="true" strokeWidth={active === href ? 2.4 : 1.65} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
