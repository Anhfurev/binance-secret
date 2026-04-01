// Insert a trade
export async function insertTrade(trade) {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.from("trades").insert([trade]);
  if (error) throw error;
  return data;
}

// Insert an account balance snapshot
export async function insertAccountBalance(balance) {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase
    .from("account_balances")
    .insert([balance]);
  if (error) throw error;
  return data;
}

// Fetch trade history for a user
export async function fetchTradeHistory(user_id) {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .eq("user_id", user_id)
    .order("opened_at", { ascending: false });
  if (error) throw error;
  return data;
}

// Fetch account balance history for a user
export async function fetchAccountBalanceHistory(user_id) {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase
    .from("account_balances")
    .select("*")
    .eq("user_id", user_id)
    .order("timestamp", { ascending: false });
  if (error) throw error;
  return data;
}
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;
