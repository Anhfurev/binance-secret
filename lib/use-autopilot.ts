import { useEffect } from "react";

export function useAutopilot(enabled: boolean, account: any, setAccount: any) {
  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(() => {
      console.log("AI is scanning for trades...");
      // Move your StrategyEngine logic here
      // This is where RSI and EMA checks happen
    }, 15000); // 15 seconds

    return () => clearInterval(timer);
  }, [enabled, account]);
}
