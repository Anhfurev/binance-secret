export type WalletMode = "demo" | "real";
export type CopyProfile = "conservative" | "balanced" | "aggressive";
export type AutoPilotMode = "signals" | "dca";
export type CloudSyncState =
  | "disabled"
  | "local"
  | "syncing"
  | "synced"
  | "error";

export interface DemoAccountProfile {
  id: string;
  name: string;
  payload: string;
}

export interface BinanceConnectionState {
  checking: boolean;
  connected: boolean;
  configured: boolean;
  error?: string;
}

export const AUTOMATION_EVENT = "nextrade:automation-toggle";
