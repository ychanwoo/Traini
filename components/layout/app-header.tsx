import type { ReactNode } from "react";

type AppHeaderProps = {
  title?: string;
  trailing?: ReactNode;
};

export function AppHeader({ title = "Traini", trailing }: AppHeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between px-5">
      <p className="text-base font-semibold tracking-tight text-[#1F1726]">{title}</p>
      {trailing ? <div className="flex items-center">{trailing}</div> : null}
    </header>
  );
}
