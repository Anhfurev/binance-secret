import type { DemoAccount } from "@/lib/types";

export interface PaperAutomationTickResult {
  account: DemoAccount;
  changed: boolean;
  summary: string;
}
