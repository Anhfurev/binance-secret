"use client";

import { createContext, useContext, useMemo } from "react";
import type { LanguageMode } from "@/lib/language";

interface LanguageContextValue {
  language: LanguageMode;
  setLanguage: (language: LanguageMode) => void;
  toggleLanguage: () => void;
  t: (en: string, mn: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined,
);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const language: LanguageMode = "en";

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage: () => undefined,
      toggleLanguage: () => undefined,
      t: (en: string, _mn: string) => en,
    }),
    [],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return context;
}
