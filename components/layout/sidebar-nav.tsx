"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  TrendingUp,
  Wallet,
  Target,
  Activity,
  Settings,
  Sparkles,
  Fish,
  ChartLine,
  HelpCircle,
  Zap,
  BarChart3,
  LogIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/components/language-provider";
import { useAuth } from "@/components/auth-provider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
}

const navItems: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    href: "/signals",
    label: "AI Signals",
    icon: Target,
    badge: "LIVE",
    badgeVariant: "default",
  },
  {
    href: "/predictions",
    label: "Predictions",
    icon: ChartLine,
    badge: "AI",
    badgeVariant: "outline",
  },
  {
    href: "/demo",
    label: "Paper Trade",
    icon: Wallet,
  },
  {
    href: "/optimizer",
    label: "Portfolio AI",
    icon: Sparkles,
  },
  {
    href: "/whale",
    label: "Whale Tracker",
    icon: Fish,
  },
];

const bottomNavItems: NavItem[] = [
  {
    href: "/auth",
    label: "Sign In",
    icon: LogIn,
  },
  {
    href: "/help",
    label: "Help & Guide",
    icon: HelpCircle,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
  },
];

export function SidebarNav() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { user: authUser, loading: authLoading } = useAuth();

  const getLabel = (label: string) => {
    const labels: Record<string, string> = {
      Dashboard: "Хяналтын самбар",
      "AI Signals": "AI дохио",
      "Paper Trade": "Демо арилжаа",
      "Portfolio AI": "Багцын AI",
      "Whale Tracker": "Whale хяналт",
      Predictions: "Таамаглал",
      "Help & Guide": "Тусламж",
      "Sign In": "Нэвтрэх",
      Settings: "Тохиргоо",
    };
    return t(label, labels[label] ?? label);
  };

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-16 flex-col border-r border-border/50 bg-card/50 backdrop-blur-xl lg:w-64">
        {/* Logo */}
        <div className="flex h-16 items-center border-b border-border/50 px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary glow-blue">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="hidden lg:block">
              <h1 className="text-lg font-bold tracking-tight text-foreground">
                NexTrade
              </h1>
              <p className="text-xs text-muted-foreground">
                {t("AI Trading Terminal", "AI арилжааны терминал")}
              </p>
            </div>
          </div>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          <div className="mb-4">
            <p className="mb-2 hidden px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground lg:block">
              {t("Main", "Үндсэн")}
            </p>
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;

              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link href={item.href}>
                      <Button
                        variant="ghost"
                        className={cn(
                          "w-full justify-center lg:justify-start transition-colors",
                          isActive &&
                            "bg-primary/15 text-primary hover:bg-primary/20",
                          !isActive &&
                            "text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:bg-primary/10 focus-visible:text-primary",
                        )}
                        size="default"
                      >
                        <Icon className="h-5 w-5 shrink-0" />
                        <span className="ml-3 hidden lg:inline-flex flex-1">
                          {getLabel(item.label)}
                        </span>
                        {item.badge && (
                          <Badge
                            variant={item.badgeVariant || "default"}
                            className="ml-auto hidden text-[10px] lg:inline-flex"
                          >
                            {item.badge}
                          </Badge>
                        )}
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="lg:hidden">
                    <p>{getLabel(item.label)}</p>
                    {item.badge && (
                      <Badge
                        variant={item.badgeVariant}
                        className="ml-2 text-[10px]"
                      >
                        {item.badge}
                      </Badge>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </nav>

        {/* Bottom Navigation */}
        <div className="border-t border-border/50 p-2">
          {bottomNavItems
            .filter((item) => {
              if (item.href !== "/auth") return true;
              if (authLoading) return false;
              return !authUser;
            })
            .map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Link href={item.href}>
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full justify-center lg:justify-start transition-colors",
                        isActive &&
                          "bg-primary/15 text-primary hover:bg-primary/20",
                        !isActive &&
                          "text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:bg-primary/10 focus-visible:text-primary",
                      )}
                      size="default"
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span className="ml-3 hidden lg:inline-flex">
                        {getLabel(item.label)}
                      </span>
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="lg:hidden">
                  <p>{getLabel(item.label)}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Demo Status */}
        <div className="hidden border-t border-border/50 p-4 lg:block">
          <div className="rounded-lg bg-primary/10 p-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-success" />
              <span className="text-xs font-medium text-foreground">
                Demo Active
              </span>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t("29 days remaining", "29 хоног үлдсэн")}
            </p>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  );
}
