"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Target,
  Wallet,
  Sparkles,
  MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/components/language-provider";

const mainNavItems = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/signals", label: "Signals", icon: Target, badge: true },
  { href: "/predictions", label: "Predict", icon: Sparkles },
  { href: "/demo", label: "Paper", icon: Wallet },
];

const moreNavItems = [
  { href: "/profile", label: "Profile" },
  { href: "/optimizer", label: "Portfolio AI" },
  { href: "/whale", label: "Whale Tracker" },
  { href: "/help", label: "Help & Guide" },
  { href: "/settings", label: "Settings" },
];

export function MobileNav() {
  const pathname = usePathname();
  const { t } = useLanguage();

  const getLabel = (label: string) => {
    const labels: Record<string, string> = {
      Home: "Нүүр",
      Signals: "Дохио",
      Predict: "Таамаг",
      Paper: "Демо",
      "Portfolio AI": "Багцын AI",
      "Whale Tracker": "Whale хяналт",
      "Help & Guide": "Тусламж",
      Settings: "Тохиргоо",
      Profile: "Профайл",
      More: "Бусад",
    };
    return t(label, labels[label] ?? label);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-card/95 backdrop-blur-xl lg:hidden">
      <div className="flex h-16 items-center justify-around px-2">
        {mainNavItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex flex-col items-center gap-1 px-3 py-2 text-xs",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{getLabel(item.label)}</span>
              {item.badge && (
                <Badge
                  variant="default"
                  className="absolute -top-1 right-0 h-4 px-1 text-[8px]"
                >
                  {t("NEW", "ШИНЭ")}
                </Badge>
              )}
            </Link>
          );
        })}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="flex flex-col items-center gap-1 px-3 py-2 text-muted-foreground hover:bg-primary/10 hover:text-primary data-[state=open]:bg-primary/10 data-[state=open]:text-primary"
            >
              <MoreHorizontal className="h-5 w-5" />
              <span className="text-xs">{getLabel("More")}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="mb-2 w-48 border-border/70 bg-card/95 backdrop-blur-xl"
          >
            {moreNavItems.map((item) => (
              <DropdownMenuItem
                key={item.href}
                className="cursor-pointer focus:bg-primary/10 focus:text-primary"
                asChild
              >
                <Link href={item.href}>{getLabel(item.label)}</Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
