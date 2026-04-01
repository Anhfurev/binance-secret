"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { LANGUAGE_STORAGE_KEY, type LanguageMode } from "@/lib/language";

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
  const [language, setLanguage] = useState<LanguageMode>("en");

  useEffect(() => {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "en" || saved === "mn") {
      setLanguage(saved);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      toggleLanguage: () =>
        setLanguage((prev) => (prev === "en" ? "mn" : "en")),
      t: (en: string, mn: string) => (language === "mn" ? mn : en),
    }),
    [language],
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
