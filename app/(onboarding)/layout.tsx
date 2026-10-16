import { requireAdminPage } from "@/lib/auth/page-access";
import type { ReactNode } from "react";
import { BottomNavigation } from "@/components/layout/bottom-navigation";
import { AuthGuard } from "@/components/auth/auth-guard";

export default async function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAdminPage();
  return (
    <AuthGuard>
      <div className="service-content">{children}</div>
      <BottomNavigation />
    </AuthGuard>
  );
}
