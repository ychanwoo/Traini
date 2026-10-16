import { requireAdminPage } from "@/lib/auth/page-access";
import type { ReactNode } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { BottomNavigation } from "@/components/layout/bottom-navigation";
import { AppTabHeader } from "@/components/layout/app-tab-header";
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return (
    <AuthGuard>
      <div className="app-frame app-tab-shell">
        <AppTabHeader />
        <div className="app-tab-content">{children}</div>
        <BottomNavigation />
      </div>
    </AuthGuard>
  );
}
