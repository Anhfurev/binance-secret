import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isBinanceRestGatewayEnabled,
  resolveBinanceRestBaseUrl,
  resolveBinanceStreamTickBaseUrl,
  shouldSkipEgressIpCheck,
} from "../binance-rest-base.ts";

Deno.test("resolveBinanceRestBaseUrl defaults to Binance", () => {
  Deno.env.delete("BINANCE_REST_GATEWAY_URL");
  Deno.env.delete("BINANCE_API_GATEWAY_URL");
  Deno.env.delete("BINANCE_STREAM_TICK_GATEWAY_URL");
  Deno.env.delete("BINANCE_STREAM_GATEWAY_URL");
  assertEquals(resolveBinanceRestBaseUrl(), "https://api.binance.com");
  assertEquals(resolveBinanceStreamTickBaseUrl(), "https://api.binance.com");
  assertEquals(isBinanceRestGatewayEnabled(), false);
  assertEquals(shouldSkipEgressIpCheck(), false);
});

Deno.test("resolveBinanceStreamTickBaseUrl honors dedicated stream gateway", () => {
  Deno.env.set("BINANCE_REST_GATEWAY_URL", "http://rest.example");
  Deno.env.set("BINANCE_STREAM_TICK_GATEWAY_URL", "http://stream.example");
  assertEquals(resolveBinanceRestBaseUrl(), "http://rest.example");
  assertEquals(resolveBinanceStreamTickBaseUrl(), "http://stream.example");
  Deno.env.delete("BINANCE_STREAM_TICK_GATEWAY_URL");
  Deno.env.delete("BINANCE_REST_GATEWAY_URL");
});
