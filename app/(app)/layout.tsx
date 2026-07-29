import type { ReactNode } from "react";

import { BottomNavigation } from "@/components/layout/bottom-navigation";
import { MobileShell } from "@/components/layout/mobile-shell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <MobileShell>
      <div className="flex min-h-dvh flex-col lg:min-h-[844px]">
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <BottomNavigation />
      </div>
    </MobileShell>
  );
}
