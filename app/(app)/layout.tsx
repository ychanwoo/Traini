import type { ReactNode } from "react";
import { AuthGuard } from "@/components/auth/auth-guard";
import { AppTabHeader } from "@/components/layout/app-tab-header";
export default function AppLayout({ children }: { children: ReactNode }) { return <AuthGuard><div className="app-frame app-tab-shell"><AppTabHeader /><div className="app-tab-content">{children}</div></div></AuthGuard>; }
