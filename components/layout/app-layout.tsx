"use client";

import { SidebarNav } from "./sidebar-nav";
import { MobileNav } from "./mobile-nav";
import { useBalance } from "@/components/balance-provider";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { demoBalance } = useBalance();

  return (
    <div className="min-h-screen gradient-bg grid-background">
      <SidebarNav />

      <main className="relative min-h-screen pb-20 pl-16 lg:pb-0 lg:pl-64">
        <div className="absolute right-4 top-4 z-30 flex items-center gap-2 lg:right-6">
          <div className="hidden rounded-md border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary md:block">
            Balance: ${demoBalance.toLocaleString()}
          </div>
        </div>

        {children}
      </main>

      <MobileNav />
    </div>
  );
}
