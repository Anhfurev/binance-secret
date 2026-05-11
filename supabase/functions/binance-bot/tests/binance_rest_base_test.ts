import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isBinanceRestGatewayEnabled,
  resolveBinanceRestBaseUrl,
  shouldSkipEgressIpCheck,
} from "../binance-rest-base.ts";

Deno.test("resolveBinanceRestBaseUrl defaults to Binance", () => {
  Deno.env.delete("BINANCE_REST_GATEWAY_URL");
  Deno.env.delete("BINANCE_API_GATEWAY_URL");
  assertEquals(resolveBinanceRestBaseUrl(), "https://api.binance.com");
  assertEquals(isBinanceRestGatewayEnabled(), false);
  assertEquals(shouldSkipEgressIpCheck(), false);
});
