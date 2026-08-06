import Link from "next/link";
import { CalendarDays, Footprints, Route, UserRound } from "lucide-react";

export function SettingsNavigation() {
  return <nav className="bottom-nav" aria-label="Main navigation"><Link href="/today"><Footprints /><span>오늘</span></Link><Link href="/schedule"><CalendarDays /><span>일정</span></Link><Link href="/roadmap"><Route /><span>로드맵</span></Link><Link className="active" href="/my"><UserRound /><span>마이</span></Link></nav>;
}
