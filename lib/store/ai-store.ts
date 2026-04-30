"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { AITradeSignal } from "@/lib/types";

type AiMode = "demo" | "off";
type WalletMode = "demo" | "real";
type AutoPilotMode = "signals" | "dca";

interface AiStoreState {
  isOpen: boolean;
  mode: AiMode;
  walletMode: WalletMode;
  autoPilotEnabled: boolean;
  autoPilotMode: AutoPilotMode;
  processing: boolean;
  tradeSignals: AITradeSignal[];
  lastPrompt: string;
  open: () => void;
  close: () => void;
  setMode: (mode: AiMode) => void;
  setWalletMode: (mode: WalletMode) => void;
  setAutoPilotEnabled: (enabled: boolean) => void;
  setAutoPilotMode: (mode: AutoPilotMode) => void;
  setProcessing: (processing: boolean) => void;
  setTradeSignals: (signals: AITradeSignal[]) => void;
  setPrompt: (prompt: string) => void;
}

function areSignalsEquivalent(nextSignals: AITradeSignal[], prevSignals: AITradeSignal[]) {
  if (nextSignals === prevSignals) return true;
  if (nextSignals.length !== prevSignals.length) return false;
  for (let i = 0; i < nextSignals.length; i += 1) {
    const next = nextSignals[i];
    const prev = prevSignals[i];
    if (!next || !prev) return false;
    if (
      next.id !== prev.id ||
      next.signalType !== prev.signalType ||
      next.confidence !== prev.confidence ||
      next.currentPrice !== prev.currentPrice
    ) {
      return false;
    }
  }
  return true;
}

export const useAiStore = create<AiStoreState>()(
  persist(
    (set) => ({
      isOpen: false,
      mode: "demo",
      walletMode: "demo",
      autoPilotEnabled: false,
      autoPilotMode: "signals",
      processing: false,
      tradeSignals: [],
      lastPrompt: "",
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      setMode: (mode) => set({ mode }),
      setWalletMode: (walletMode) => set({ walletMode }),
      setAutoPilotEnabled: (autoPilotEnabled) => set({ autoPilotEnabled }),
      setAutoPilotMode: (autoPilotMode) => set({ autoPilotMode }),
      setProcessing: (processing) => set({ processing }),
      setTradeSignals: (tradeSignals) =>
        set((state) =>
          areSignalsEquivalent(tradeSignals, state.tradeSignals)
            ? state
            : { tradeSignals }
        ),
      setPrompt: (lastPrompt) => set({ lastPrompt }),
    }),
    {
      name: "nextrade-ai-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mode: state.mode,
        walletMode: state.walletMode,
        autoPilotEnabled: state.autoPilotEnabled,
        autoPilotMode: state.autoPilotMode,
        lastPrompt: state.lastPrompt,
      }),
    },
  ),
);
