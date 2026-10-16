import type { ReactNode } from "react";
import { BottomNavigation } from "@/components/layout/bottom-navigation";
import { AuthGuard } from "@/components/auth/auth-guard";

export default function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AuthGuard>
      <div className="service-content">{children}</div>
      <BottomNavigation />
    </AuthGuard>
  );
}
