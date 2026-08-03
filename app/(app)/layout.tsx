import type { ReactNode } from "react";
import { AppTabHeader } from "@/components/layout/app-tab-header";
export default function AppLayout({ children }: { children: ReactNode }) { return <div className="app-frame app-tab-shell"><AppTabHeader /><div className="app-tab-content">{children}</div></div>; }
