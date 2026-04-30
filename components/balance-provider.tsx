"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";

type BalanceContextValue = {
  profileId: string | null;
  demoBalance: number;
  startingBalance: number;
  updatedAt: string | null;
  loading: boolean;
};

const BalanceContext = createContext<BalanceContextValue | null>(null);

type ProfileRow = {
  id: string;
  demo_balance: number | string | null;
  starting_balance: number | string | null;
  updated_at: string | null;
};

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function BalanceProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [demoBalance, setDemoBalance] = useState(0);
  const [startingBalance, setStartingBalance] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!supabase || !user?.id) {
      void Promise.resolve().then(() => {
        setProfileId(null);
        setDemoBalance(0);
        setStartingBalance(0);
        setUpdatedAt(null);
        setLoading(false);
      });
      return;
    }

    let active = true;

    const hydrateFromProfile = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, demo_balance, starting_balance, updated_at")
        .eq("id", user.id)
        .maybeSingle();

      if (!active) return;

      if (error || !data) {
        setProfileId(user.id);
        setLoading(false);
        return;
      }

      const row = data as ProfileRow;
      setProfileId(row.id);
      setDemoBalance(toFiniteNumber(row.demo_balance, 0));
      setStartingBalance(toFiniteNumber(row.starting_balance, 0));
      setUpdatedAt(row.updated_at ?? null);
      setLoading(false);
    };

    void hydrateFromProfile();

    const channel = supabase
      .channel(`profiles-balance-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as ProfileRow;
          console.log("Real-time update:", row?.demo_balance);
          setProfileId(row?.id ?? user.id);
          setDemoBalance(toFiniteNumber(row?.demo_balance, 0));
          setStartingBalance(toFiniteNumber(row?.starting_balance, 0));
          setUpdatedAt(row?.updated_at ?? new Date().toISOString());
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [authLoading, user?.id]);

  const value = useMemo<BalanceContextValue>(
    () => ({
      profileId,
      demoBalance,
      startingBalance,
      updatedAt,
      loading,
    }),
    [profileId, demoBalance, startingBalance, updatedAt, loading],
  );

  return (
    <BalanceContext.Provider value={value}>{children}</BalanceContext.Provider>
  );
}

export function useBalance() {
  const ctx = useContext(BalanceContext);
  if (!ctx) {
    return {
      profileId: null,
      demoBalance: 0,
      startingBalance: 0,
      updatedAt: null,
      loading: false,
    };
  }
  return ctx;
}
