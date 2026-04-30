"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProvider } from "@/components/language-provider";
import { AuthProvider } from "@/components/auth-provider";
import { BalanceProvider } from "@/components/balance-provider";
import { GlobalRuntimeLogger } from "@/components/global-runtime-logger";
import { Toaster } from "@/components/ui/sonner";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <LanguageProvider>
        <AuthProvider>
          <BalanceProvider>
            <GlobalRuntimeLogger />
            <div>{children}</div>
            <Toaster richColors />
          </BalanceProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
