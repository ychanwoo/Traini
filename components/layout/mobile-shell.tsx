import type { ReactNode } from "react";

type MobileShellProps = {
  children: ReactNode;
};

/** Keeps the product in an app-like frame on larger screens. */
export function MobileShell({ children }: MobileShellProps) {
  return (
    <main className="min-h-dvh bg-[#F3E8FF] lg:flex lg:items-center lg:justify-center lg:p-8">
      <section className="min-h-dvh w-full bg-white lg:min-h-[844px] lg:max-w-[390px] lg:overflow-hidden lg:rounded-[28px] lg:shadow-2xl">
        {children}
      </section>
    </main>
  );
}
