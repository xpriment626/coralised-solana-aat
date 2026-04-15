import { tool } from "ai";
import { z } from "zod";

const API_KEY = process.env.COINGECKO_API_KEY;
const KEY_TYPE = process.env.COINGECKO_API_KEY_TYPE ?? "demo";
const BASE_URL =
  KEY_TYPE === "pro"
    ? "https://pro-api.coingecko.com/api/v3/onchain"
    : "https://api.coingecko.com/api/v3/onchain";
const AUTH_HEADER =
  KEY_TYPE === "pro" ? "x-cg-pro-api-key" : "x-cg-demo-api-key";

function headers(): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  if (API_KEY) h[AUTH_HEADER] = API_KEY;
  return h;
}

export const tools = {
  coingecko_get_token_price: tool({
    description:
      "Get the current USD price and 24h stats for a token on Solana by its contract address",
    parameters: z.object({
      address: z
        .string()
        .describe("Solana token contract (mint) address"),
    }),
    execute: async ({ address }) => {
      const res = await fetch(
        `${BASE_URL}/simple/networks/solana/token_price/${address}`,
        { headers: headers() }
      );
      if (!res.ok) return { error: `CoinGecko API error ${res.status}` };
      const data = await res.json();
      return data.data?.attributes ?? data;
    },
  }),

  coingecko_get_pool_data: tool({
    description:
      "Get detailed data for a specific liquidity pool on Solana including price, volume, and liquidity",
    parameters: z.object({
      poolAddress: z
        .string()
        .describe("Pool contract address on Solana"),
    }),
    execute: async ({ poolAddress }) => {
      const res = await fetch(
        `${BASE_URL}/networks/solana/pools/${poolAddress}`,
        { headers: headers() }
      );
      if (!res.ok) return { error: `CoinGecko API error ${res.status}` };
      const data = await res.json();
      return data.data?.attributes ?? data;
    },
  }),

  coingecko_get_ohlcv: tool({
    description:
      "Get OHLCV candlestick chart data for a pool on Solana",
    parameters: z.object({
      poolAddress: z
        .string()
        .describe("Pool contract address on Solana"),
      timeframe: z
        .enum(["day", "hour", "minute"])
        .describe("Candle timeframe"),
      aggregate: z
        .number()
        .optional()
        .describe(
          "Candle size multiplier (e.g. 15 for 15-minute candles). Default 1"
        ),
      limit: z
        .number()
        .optional()
        .describe("Number of candles to return (default 100, max 1000)"),
    }),
    execute: async ({ poolAddress, timeframe, aggregate, limit }) => {
      const params = new URLSearchParams({ currency: "usd" });
      if (aggregate) params.set("aggregate", String(aggregate));
      if (limit) params.set("limit", String(limit));
      const res = await fetch(
        `${BASE_URL}/networks/solana/pools/${poolAddress}/ohlcv/${timeframe}?${params}`,
        { headers: headers() }
      );
      if (!res.ok) return { error: `CoinGecko API error ${res.status}` };
      const data = await res.json();
      return data.data?.attributes ?? data;
    },
  }),
};
