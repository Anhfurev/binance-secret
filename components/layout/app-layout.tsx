"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import Link from "next/link";

import { SidebarNav } from "./sidebar-nav";
import { MobileNav } from "./mobile-nav";
import { Chatbot } from "@/components/dashboard/chatbot";
import {
  useMarketData,
  useGrowthCandidates,
  useSentimentData,
  useSignalsData,
  usePredictionsData,
  usePaperTradingSnapshot,
  usePortfolioSnapshot,
  useWhaleActivity,
} from "@/hooks/use-dashboard-data";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Languages, Moon, Sun } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

interface AppLayoutProps {
  children: React.ReactNode;
  showChatbot?: boolean;
}

export function AppLayout({ children, showChatbot = true }: AppLayoutProps) {
  const { coins } = useMarketData();
  const { candidates } = useGrowthCandidates();
  const { sentiment } = useSentimentData();
  const { signals, refresh: refreshSignals } = useSignalsData();
  const { predictions, refresh: refreshPredictions } = usePredictionsData();
  const { paperTrading, refresh: refreshPaperTrading } =
    usePaperTradingSnapshot();
  const { portfolio, refresh: refreshPortfolio } = usePortfolioSnapshot();
  const { transactions: whales, refresh: refreshWhales } = useWhaleActivity();
  const { language, toggleLanguage, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { user: authUser, loading: authLoading } = useAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const resolveContext = useCallback(
    async (_message: string) => {
      const [
        nextSignals,
        nextPredictions,
        nextWhales,
        nextPaperTrading,
        nextPortfolio,
      ] = await Promise.all([
        refreshSignals(),
        refreshPredictions(),
        refreshWhales(),
        Promise.resolve(refreshPaperTrading()),
        refreshPortfolio(),
      ]);

      return {
        signals: nextSignals.length > 0 ? nextSignals : signals,
        predictions: nextPredictions.length > 0 ? nextPredictions : predictions,
        whales: nextWhales.length > 0 ? nextWhales : whales,
        paperTrading: nextPaperTrading,
        portfolio: nextPortfolio,
      };
    },
    [
      predictions,
      refreshPaperTrading,
      refreshPortfolio,
      refreshPredictions,
      refreshSignals,
      refreshWhales,
      signals,
      whales,
    ],
  );

  return (
    <div className="min-h-screen gradient-bg grid-background">
      <SidebarNav />

      <main className="relative min-h-screen pb-20 pl-16 lg:pb-0 lg:pl-64">
        <div className="absolute right-4 top-4 z-30 flex items-center gap-2 lg:right-6">
          <div className="hidden items-center gap-2 md:flex">
            {!authLoading && !authUser && (
              <>
                <Button asChild size="sm" variant="outline">
                  <Link href="/sign-in">{t("Sign In", "Нэвтрэх")}</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/sign-up">{t("Sign Up", "Бүртгүүлэх")}</Link>
                </Button>
              </>
            )}
          </div>
          {mounted && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="border-border/60 bg-card/90 backdrop-blur-md"
              title={
                theme === "dark"
                  ? "Switch to Light Mode"
                  : "Switch to Dark Mode"
              }
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={toggleLanguage}
            className="border-border/60 bg-card/90 backdrop-blur-md"
          >
            <Languages className="mr-2 h-4 w-4" />
            {t("Language", "Хэл")}: {language.toUpperCase()}
          </Button>
        </div>

        {children}
      </main>

      <MobileNav />

      {showChatbot && (
        <Chatbot
          candidates={candidates}
          coins={coins}
          sentiment={sentiment}
          signals={signals}
          predictions={predictions}
          whales={whales}
          portfolio={portfolio}
          paperTrading={paperTrading}
          resolveContext={resolveContext}
        />
      )}
    </div>
  );
}
