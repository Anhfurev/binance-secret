import { readListenPort } from "./config.ts";
import { bootstrapMarketCacheFromRest } from "./hub-bootstrap.ts";
import { handleHubRequest } from "./hub-routes.ts";
import { runBinanceWsManager } from "./binance-ws-manager.ts";

const port = readListenPort();

await bootstrapMarketCacheFromRest();
Deno.serve({ port, hostname: "127.0.0.1" }, handleHubRequest);
void runBinanceWsManager();
