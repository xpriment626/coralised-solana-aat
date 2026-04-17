import { defineAtom } from "./manifest.js";

const misc = "@solana-agent-kit/plugin-misc";
const token = "@solana-agent-kit/plugin-token";

export const marketTrendsAtom = defineAtom({
  name: "market-trends",
  purpose: "Discover current token and pool trends from CoinGecko.",
  actions: [
    { packageName: misc, actionName: "GET_COINGECKO_TRENDING_TOKENS_ACTION", risk: "read" },
    { packageName: misc, actionName: "GET_COINGECKO_TRENDING_POOLS_ACTION", risk: "read" },
    { packageName: misc, actionName: "GET_COINGECKO_TOP_GAINERS", risk: "read" },
    { packageName: misc, actionName: "GET_COINGECKO_LATEST_POOLS", risk: "read" },
  ],
  accepts: ["trend request", "pool discovery request", "top gainer request"],
  returns: ["ranked trend candidates", "pool activity context"],
  handoffs: ["token-info", "market-price", "oracle-price"],
});

export const tokenInfoAtom = defineAtom({
  name: "token-info",
  purpose: "Resolve token identity and metadata from CoinGecko.",
  actions: [
    { packageName: misc, actionName: "GET_COINGECKO_TOKEN_INFO_ACTION", risk: "read" },
  ],
  accepts: ["token address", "token id", "candidate token from trend result"],
  returns: ["token identity", "metadata context"],
  handoffs: ["market-price", "oracle-price"],
});

export const marketPriceAtom = defineAtom({
  name: "market-price",
  purpose: "Fetch CoinGecko token price data by token address.",
  actions: [
    { packageName: misc, actionName: "GET_COINGECKO_TOKEN_PRICE_DATA_ACTION", risk: "read" },
  ],
  accepts: ["token address list"],
  returns: ["CoinGecko price data", "missing coverage notes"],
  handoffs: ["oracle-price", "token-info"],
});

export const oraclePriceAtom = defineAtom({
  name: "oracle-price",
  purpose: "Fetch Pyth oracle prices for supported token symbols.",
  actions: [
    { packageName: token, actionName: "PYTH_FETCH_PRICE", risk: "read" },
  ],
  accepts: ["token symbol"],
  returns: ["oracle price", "coverage or freshness notes"],
  handoffs: ["market-price", "token-info"],
});

export const walletAssetsAtom = defineAtom({
  name: "wallet-assets",
  purpose: "Fetch wallet asset inventory from Helius DAS.",
  actions: [
    { packageName: misc, actionName: "FETCH_ASSETS_BY_OWNER", risk: "read" },
  ],
  accepts: ["owner wallet public key"],
  returns: ["wallet asset inventory", "fungible asset context"],
  handoffs: ["token-info", "market-price"],
});

export const marketDataAtoms = [
  marketTrendsAtom,
  tokenInfoAtom,
  marketPriceAtom,
  oraclePriceAtom,
  walletAssetsAtom,
];
