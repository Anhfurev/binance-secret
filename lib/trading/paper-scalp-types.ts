import type { DemoAccount } from "@/lib/types";

export interface PaperAutomationTickResult {
  account: DemoAccount;
  changed: boolean;
  summary: string;
  /** Pyramid scale-in executed this tick. */
  pyramided?: boolean;
  /** Full leg closed in Phase 1. */
  positionClosed?: boolean;
  /** 70% velocity take-profit partial sell. */
  velocityPartial?: boolean;
  /** New position opened. */
  entryExecuted?: boolean;
}
