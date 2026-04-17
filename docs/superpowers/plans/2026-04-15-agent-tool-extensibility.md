# Agent Tool Extensibility Implementation Plan

> **Status:** Pre-overlay. Predates the CLAUDE.md island-plan conventions (no header with Design Source / Depends On / Scope Summary, tasks lack Verification and Stop Condition fields). Do not use as a template for new plans.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 6 Tier 1 Coralised agents real execution tools so they can act on their skills, not just discuss them.

**Architecture:** Each agent gets a hand-written `tools.ts` file containing Vercel AI SDK tool definitions with Zod schemas. Tools merge with Coral coordination tools in the shared runtime via a flat `{ ...coralTools, ...agentTools }` merge. Signing agents receive a `Wallet` instance for transaction signing; read-only agents export plain tool objects. All external API calls use raw `fetch` — no protocol-specific SDKs.

**Tech Stack:** TypeScript, Vercel AI SDK (`ai` + `tool` + `z`), `@solana/web3.js` (transactions, keypairs, connections), `bs58` (key decoding), raw HTTP `fetch` (all external APIs)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `shared/wallet.ts` | `Wallet` interface + `KeypairWallet` dev-only implementation |
| `shared/rpc.ts` | Singleton Solana `Connection` from `SOLANA_RPC_URL` env var |
| `agents/coingecko/tools.ts` | CoinGecko price, pool, and OHLCV tools (read-only) |
| `agents/pyth/tools.ts` | Pyth Hermes price feed tools (read-only) |
| `agents/helius/tools.ts` | Helius DAS + priority fee tools (read-only) |
| `agents/switchboard/tools.ts` | Switchboard Crossbar feed simulation tool (read-only) |
| `agents/jupiter-swap/tools.ts` | Jupiter Ultra swap tools (signing) |
| `agents/pumpfun/tools.ts` | PumpFun buy/sell/create tools (signing) |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add `@solana/web3.js`, `bs58` dependencies |
| `shared/coral-loop.ts` | Add `tools` field to `AgentConfig`, merge agent tools with coral tools |
| `agents/coingecko/index.ts` | Import tools, add "Your Tools" prompt section, pass tools to runtime |
| `agents/pyth/index.ts` | Same read-only pattern |
| `agents/helius/index.ts` | Same read-only pattern |
| `agents/switchboard/index.ts` | Same read-only pattern |
| `agents/jupiter-swap/index.ts` | Import `createTools` + wallet, construct wallet from env, pass tools |
| `agents/pumpfun/index.ts` | Same signing pattern |
| `scripts/generate-agents.ts` | Add `signing` field, new templates with tools import, skip hand-maintained agents |

---

## Phase 1: Shared Infrastructure

### Task 1: Install Core Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install @solana/web3.js and bs58**

```bash
npm install @solana/web3.js bs58
```

These are the only two root-level dependencies added. `@solana/web3.js` provides `Keypair`, `PublicKey`, `Transaction`, `VersionedTransaction`, and `Connection`. `bs58` decodes the `SOLANA_PRIVATE_KEY` env var from base58.

- [ ] **Step 2: Verify installation**

```bash
npx tsc --noEmit
```

Expected: passes (no new code references the packages yet).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add @solana/web3.js and bs58 for agent tool infrastructure"
```

---

### Task 2: Create Wallet Interface

**Files:**
- Create: `shared/wallet.ts`

- [ ] **Step 1: Write `shared/wallet.ts`**

```ts
import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

/**
 * Standard Solana wallet interface — matches the wallet-adapter contract
 * used by Turnkey, Privy, Crossmint, and SendAI's agent kit.
 * Any provider implementing these four members is a drop-in replacement.
 */
export interface Wallet {
  publicKey: PublicKey;
  signTransaction(
    tx: Transaction | VersionedTransaction
  ): Promise<Transaction | VersionedTransaction>;
  signAllTransactions(
    txs: (Transaction | VersionedTransaction)[]
  ): Promise<(Transaction | VersionedTransaction)[]>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * Dev-only wallet backed by a raw Keypair held in memory.
 * DO NOT use in production — use a managed wallet provider (Turnkey, Privy, etc.).
 */
export class KeypairWallet implements Wallet {
  private keypair: Keypair;
  publicKey: PublicKey;

  constructor(secretKey: Uint8Array) {
    this.keypair = Keypair.fromSecretKey(secretKey);
    this.publicKey = this.keypair.publicKey;
  }

  async signTransaction(
    tx: Transaction | VersionedTransaction
  ): Promise<Transaction | VersionedTransaction> {
    if (tx instanceof VersionedTransaction) {
      tx.sign([this.keypair]);
      return tx;
    }
    tx.partialSign(this.keypair);
    return tx;
  }

  async signAllTransactions(
    txs: (Transaction | VersionedTransaction)[]
  ): Promise<(Transaction | VersionedTransaction)[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    // Ed25519 detached signature using the keypair's secret key.
    // tweetnacl is a transitive dep of @solana/web3.js — always available.
    const nacl = await import("tweetnacl");
    return nacl.default.sign.detached(message, this.keypair.secretKey);
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes. If `tweetnacl` types are missing, install them: `npm install -D @types/tweetnacl`.

- [ ] **Step 3: Commit**

```bash
git add shared/wallet.ts
git commit -m "feat: add Wallet interface and KeypairWallet for agent signing"
```

---

### Task 3: Create RPC Helper

**Files:**
- Create: `shared/rpc.ts`

- [ ] **Step 1: Write `shared/rpc.ts`**

```ts
import { Connection } from "@solana/web3.js";

let _connection: Connection | null = null;

/**
 * Singleton Solana RPC connection from SOLANA_RPC_URL env var.
 * Shared across all tool handlers within an agent process.
 * One connection per agent, not per tool call.
 */
export function getConnection(): Connection {
  if (!_connection) {
    const url = process.env.SOLANA_RPC_URL;
    if (!url) {
      console.error("Missing SOLANA_RPC_URL environment variable");
      process.exit(1);
    }
    _connection = new Connection(url, "confirmed");
  }
  return _connection;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add shared/rpc.ts
git commit -m "feat: add shared RPC connection singleton for agent tools"
```

---

### Task 4: Update Coral Loop Runtime

**Files:**
- Modify: `shared/coral-loop.ts:18-34` (AgentConfig interface)
- Modify: `shared/coral-loop.ts:177` (tool merging in runCoralAgent)

- [ ] **Step 1: Add `tools` field to `AgentConfig`**

In `shared/coral-loop.ts`, find the `AgentConfig` interface and add the `tools` field:

Old:
```ts
export interface AgentConfig {
  /** Display name shown in logs */
  name: string;
  /** Full system prompt — domain expertise + Coral coordination instructions */
  systemPrompt: string;
  /**
   * Raw GitHub URL to this agent's SKILL.md from sendaifun/skills.
   * Fetched once at startup and appended to the system prompt.
   * e.g. "https://raw.githubusercontent.com/sendaifun/skills/main/skills/helius/SKILL.md"
   */
  skillUrl?: string;
  /** OpenAI model id (default: gpt-5.4-mini) */
  model?: string;
  /** Max tool-call steps per LLM invocation (default: 15) */
  maxSteps?: number;
}
```

New:
```ts
export interface AgentConfig {
  /** Display name shown in logs */
  name: string;
  /** Full system prompt — domain expertise + Coral coordination instructions */
  systemPrompt: string;
  /**
   * Raw GitHub URL to this agent's SKILL.md from sendaifun/skills.
   * Fetched once at startup and appended to the system prompt.
   * e.g. "https://raw.githubusercontent.com/sendaifun/skills/main/skills/helius/SKILL.md"
   */
  skillUrl?: string;
  /** OpenAI model id (default: gpt-5.4-mini) */
  model?: string;
  /** Max tool-call steps per LLM invocation (default: 15) */
  maxSteps?: number;
  /** Agent-specific execution tools — merged with Coral coordination tools */
  tools?: Record<string, any>;
}
```

- [ ] **Step 2: Merge agent tools with Coral tools**

In `shared/coral-loop.ts`, find the tool bridging section in `runCoralAgent()` and update it:

Old:
```ts
  const aiTools = bridgeTools(mcpTools, client);
  console.log(
    `[${config.name}] Bridged ${Object.keys(aiTools).length} coral tools to AI SDK`
  );
```

New:
```ts
  const coralTools = bridgeTools(mcpTools, client);
  const aiTools = { ...coralTools, ...(config.tools ?? {}) };
  const agentToolCount = Object.keys(config.tools ?? {}).length;
  console.log(
    `[${config.name}] Bridged ${Object.keys(coralTools).length} coral tools + ${agentToolCount} agent tools to AI SDK`
  );
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes. Existing agents don't pass `tools`, so `config.tools` is `undefined` and the spread produces `{}`.

- [ ] **Step 4: Commit**

```bash
git add shared/coral-loop.ts
git commit -m "feat: support agent-specific tools in coral loop runtime"
```

---

## Phase 2: Read-Only Agent Tools

Tasks 5–8 are independent and can be executed in parallel by separate subagents.

### Task 5: CoinGecko Agent Tools

**Files:**
- Create: `agents/coingecko/tools.ts`
- Modify: `agents/coingecko/index.ts` (full rewrite)

**API Details:**
- Base URL: `https://api.coingecko.com/api/v3/onchain` (demo) or `https://pro-api.coingecko.com/api/v3/onchain` (pro)
- Auth: `x-cg-demo-api-key` or `x-cg-pro-api-key` header
- Env vars: `COINGECKO_API_KEY`, `COINGECKO_API_KEY_TYPE` (default "demo")
- Network param for Solana: `solana`

- [ ] **Step 1: Create `agents/coingecko/tools.ts`**

```ts
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
```

- [ ] **Step 2: Rewrite `agents/coingecko/index.ts`**

```ts
import { runCoralAgent } from "../../shared/coral-loop.js";
import { tools } from "./tools.js";

const SYSTEM_PROMPT = `You are solana-coingecko, a specialised Solana agent.

You are an expert on integrating CoinGecko's Solana API for market data. You cover token price lookups, DEX pool data, OHLCV charts, trade history, and market analytics. You help build trading bots, portfolio trackers, price feeds, and on-chain data applications using CoinGecko's comprehensive API.

## Your Tools

You have the following tools available for direct execution:
- coingecko_get_token_price: Get the current USD price and 24h stats for a token by its Solana contract address
- coingecko_get_pool_data: Get detailed data for a specific liquidity pool on Solana
- coingecko_get_ohlcv: Get OHLCV candlestick chart data for a pool on Solana

When a user or another agent asks you to perform an action that matches your tools, USE THEM.
Do not describe how to perform the action — execute it directly using your tools.
If an action is outside your tool set, say so and suggest which agent might help.

## Coral Coordination Protocol

You are a Coralised agent running inside a CoralOS session. You communicate with other agents via Coral's thread-based messaging system.

### How to respond when mentioned
1. Read the mention payload to understand what is being asked of you.
2. Identify the thread ID from the mention.
3. Use \`coral_send_message\` to reply on that thread, mentioning the requesting agent by name.
4. Be specific, structured, and actionable in your responses.

### How to coordinate with other agents
- To ask another agent for help: use \`coral_create_thread\` with a descriptive topic, add them as a participant, then \`coral_send_message\` mentioning them.
- To add agents to an existing conversation: use \`coral_add_participant\`.
- After sending a message that expects a reply, use \`coral_wait_for_agent\` to block until they respond.

### Communication style
- Lead with the answer or actionable output, then explain.
- When returning code, return complete, copy-pasteable snippets.
- If you cannot fulfil a request with your domain expertise, say so clearly and suggest which specialist agent might help.
- Always identify yourself as "solana-coingecko" in your messages.
`;

runCoralAgent({
  name: "solana-coingecko",
  systemPrompt: SYSTEM_PROMPT,
  skillUrl:
    "https://raw.githubusercontent.com/sendaifun/skills/main/skills/coingecko/SKILL.md",
  tools,
});
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add agents/coingecko/tools.ts agents/coingecko/index.ts
git commit -m "feat(coingecko): add price, pool, and OHLCV execution tools"
```

---

### Task 6: Pyth Agent Tools

**Files:**
- Create: `agents/pyth/tools.ts`
- Modify: `agents/pyth/index.ts` (full rewrite)

**API Details:**
- Base URL: `https://hermes.pyth.network`
- Auth: None (public endpoint)
- Price endpoint: `GET /v2/updates/price/latest?ids[]={feedId}&parsed=true`
- Search endpoint: `GET /v2/price_feeds?query={query}&asset_type=crypto`
- Price is fixed-point: multiply by `10^expo` for human-readable value

- [ ] **Step 1: Create `agents/pyth/tools.ts`**

```ts
import { tool } from "ai";
import { z } from "zod";

const HERMES_URL = "https://hermes.pyth.network";

export const tools = {
  pyth_get_price: tool({
    description:
      "Get the latest price from Pyth oracle feeds. Returns price, confidence interval, and EMA price. Use pyth_search_price_feeds first if you don't know the feed ID.",
    parameters: z.object({
      feedIds: z
        .array(z.string())
        .describe(
          "Array of Pyth price feed IDs (hex strings with 0x prefix). Example: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' for SOL/USD"
        ),
    }),
    execute: async ({ feedIds }) => {
      const params = feedIds.map((id) => `ids[]=${id}`).join("&");
      const res = await fetch(
        `${HERMES_URL}/v2/updates/price/latest?${params}&parsed=true`
      );
      if (!res.ok) return { error: `Pyth Hermes error ${res.status}` };
      const data = await res.json();
      return (
        data.parsed?.map((p: any) => ({
          id: p.id,
          price:
            Number(p.price.price) * Math.pow(10, p.price.expo),
          confidence:
            Number(p.price.conf) * Math.pow(10, p.price.expo),
          expo: p.price.expo,
          publishTime: p.price.publish_time,
          emaPrice:
            Number(p.ema_price.price) *
            Math.pow(10, p.ema_price.expo),
        })) ?? data
      );
    },
  }),

  pyth_search_price_feeds: tool({
    description:
      "Search for Pyth price feed IDs by asset name (e.g. 'SOL', 'BTC', 'ETH'). Returns feed IDs you can pass to pyth_get_price.",
    parameters: z.object({
      query: z
        .string()
        .describe(
          "Search query — asset name or symbol (e.g. 'SOL', 'Bitcoin')"
        ),
    }),
    execute: async ({ query }) => {
      const res = await fetch(
        `${HERMES_URL}/v2/price_feeds?query=${encodeURIComponent(query)}&asset_type=crypto`
      );
      if (!res.ok) return { error: `Pyth Hermes error ${res.status}` };
      const feeds = await res.json();
      return feeds.slice(0, 10).map((f: any) => ({
        id: `0x${f.id}`,
        symbol: f.attributes?.symbol ?? f.attributes?.base,
        assetType: f.attributes?.asset_type,
      }));
    },
  }),
};
```

- [ ] **Step 2: Rewrite `agents/pyth/index.ts`**

```ts
import { runCoralAgent } from "../../shared/coral-loop.js";
import { tools } from "./tools.js";

const SYSTEM_PROMPT = `You are solana-pyth, a specialised Solana agent.

You are an expert on Pyth Network, a decentralised oracle providing real-time price feeds for DeFi. You cover price feed integration, confidence intervals, EMA (Exponential Moving Average) prices, on-chain CPI (Cross-Program Invocation) integration, off-chain fetching, and streaming price updates for Solana applications. You understand oracle design and price feed reliability.

## Your Tools

You have the following tools available for direct execution:
- pyth_get_price: Get the latest price, confidence, and EMA from Pyth oracle feeds by feed ID
- pyth_search_price_feeds: Search for Pyth price feed IDs by asset name (e.g. 'SOL', 'BTC')

When a user or another agent asks you to perform an action that matches your tools, USE THEM.
Do not describe how to perform the action — execute it directly using your tools.
If an action is outside your tool set, say so and suggest which agent might help.

## Coral Coordination Protocol

You are a Coralised agent running inside a CoralOS session. You communicate with other agents via Coral's thread-based messaging system.

### How to respond when mentioned
1. Read the mention payload to understand what is being asked of you.
2. Identify the thread ID from the mention.
3. Use \`coral_send_message\` to reply on that thread, mentioning the requesting agent by name.
4. Be specific, structured, and actionable in your responses.

### How to coordinate with other agents
- To ask another agent for help: use \`coral_create_thread\` with a descriptive topic, add them as a participant, then \`coral_send_message\` mentioning them.
- To add agents to an existing conversation: use \`coral_add_participant\`.
- After sending a message that expects a reply, use \`coral_wait_for_agent\` to block until they respond.

### Communication style
- Lead with the answer or actionable output, then explain.
- When returning code, return complete, copy-pasteable snippets.
- If you cannot fulfil a request with your domain expertise, say so clearly and suggest which specialist agent might help.
- Always identify yourself as "solana-pyth" in your messages.
`;

runCoralAgent({
  name: "solana-pyth",
  systemPrompt: SYSTEM_PROMPT,
  skillUrl:
    "https://raw.githubusercontent.com/sendaifun/skills/main/skills/pyth/SKILL.md",
  tools,
});
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add agents/pyth/tools.ts agents/pyth/index.ts
git commit -m "feat(pyth): add price feed and search execution tools"
```

---

### Task 7: Helius Agent Tools

**Files:**
- Create: `agents/helius/tools.ts`
- Modify: `agents/helius/index.ts` (full rewrite)

**API Details:**
- RPC URL: `https://mainnet.helius-rpc.com/?api-key={HELIUS_API_KEY}`
- Auth: API key as URL query parameter
- Protocol: JSON-RPC 2.0 POST
- Methods: `getAsset`, `getAssetsByOwner`, `getPriorityFeeEstimate`

- [ ] **Step 1: Create `agents/helius/tools.ts`**

```ts
import { tool } from "ai";
import { z } from "zod";

function getRpcUrl(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("Missing HELIUS_API_KEY");
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

async function rpcCall(method: string, params: unknown): Promise<any> {
  const res = await fetch(getRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method,
      params,
    }),
  });
  if (!res.ok) return { error: `Helius RPC error ${res.status}` };
  const data = await res.json();
  if (data.error) return { error: data.error.message };
  return data.result;
}

export const tools = {
  helius_get_asset: tool({
    description:
      "Get detailed information about a Solana asset (token, NFT, or compressed NFT) by its mint address using Helius DAS API",
    parameters: z.object({
      id: z.string().describe("Asset mint address or asset ID"),
    }),
    execute: async ({ id }) => {
      return rpcCall("getAsset", { id });
    },
  }),

  helius_get_assets_by_owner: tool({
    description:
      "Get all assets owned by a Solana wallet address using Helius DAS API. Returns tokens, NFTs, and compressed NFTs.",
    parameters: z.object({
      ownerAddress: z
        .string()
        .describe("Wallet address to query"),
      page: z
        .number()
        .optional()
        .describe("Page number for pagination (default 1)"),
      limit: z
        .number()
        .optional()
        .describe("Results per page (default 100, max 1000)"),
      showFungible: z
        .boolean()
        .optional()
        .describe("Include fungible tokens (default true)"),
      showNativeBalance: z
        .boolean()
        .optional()
        .describe("Include SOL balance (default true)"),
    }),
    execute: async ({
      ownerAddress,
      page,
      limit,
      showFungible,
      showNativeBalance,
    }) => {
      return rpcCall("getAssetsByOwner", {
        ownerAddress,
        page: page ?? 1,
        limit: limit ?? 100,
        displayOptions: {
          showFungible: showFungible ?? true,
          showNativeBalance: showNativeBalance ?? true,
        },
      });
    },
  }),

  helius_get_priority_fees: tool({
    description:
      "Get priority fee estimates for Solana transactions from Helius. Returns fee levels in microLamports per compute unit.",
    parameters: z.object({
      accountKeys: z
        .array(z.string())
        .describe(
          "Array of account public keys involved in the transaction"
        ),
      priorityLevel: z
        .enum([
          "min",
          "low",
          "medium",
          "high",
          "veryHigh",
          "unsafeMax",
        ])
        .optional()
        .describe(
          "Priority level to optimize for (default 'high')"
        ),
    }),
    execute: async ({ accountKeys, priorityLevel }) => {
      return rpcCall("getPriorityFeeEstimate", [
        {
          accountKeys,
          options: {
            priorityLevel: priorityLevel ?? "high",
            includeAllPriorityFeeLevels: true,
          },
        },
      ]);
    },
  }),
};
```

- [ ] **Step 2: Rewrite `agents/helius/index.ts`**

```ts
import { runCoralAgent } from "../../shared/coral-loop.js";
import { tools } from "./tools.js";

const SYSTEM_PROMPT = `You are solana-helius, a specialised Solana agent.

You are an expert on Helius, a leading Solana infrastructure provider. You cover transaction sending (Sender), asset/NFT queries (DAS API), real-time streaming (WebSockets, Laserstream), event pipelines (webhooks), priority fee estimation, wallet analysis, and agent onboarding. You help developers build production Solana applications with reliable infrastructure.

## Your Tools

You have the following tools available for direct execution:
- helius_get_asset: Get detailed info about any Solana asset (token, NFT, cNFT) by mint address
- helius_get_assets_by_owner: Get all assets owned by a wallet address (tokens, NFTs, SOL balance)
- helius_get_priority_fees: Get priority fee estimates for transactions in microLamports per compute unit

When a user or another agent asks you to perform an action that matches your tools, USE THEM.
Do not describe how to perform the action — execute it directly using your tools.
If an action is outside your tool set, say so and suggest which agent might help.

## Coral Coordination Protocol

You are a Coralised agent running inside a CoralOS session. You communicate with other agents via Coral's thread-based messaging system.

### How to respond when mentioned
1. Read the mention payload to understand what is being asked of you.
2. Identify the thread ID from the mention.
3. Use \`coral_send_message\` to reply on that thread, mentioning the requesting agent by name.
4. Be specific, structured, and actionable in your responses.

### How to coordinate with other agents
- To ask another agent for help: use \`coral_create_thread\` with a descriptive topic, add them as a participant, then \`coral_send_message\` mentioning them.
- To add agents to an existing conversation: use \`coral_add_participant\`.
- After sending a message that expects a reply, use \`coral_wait_for_agent\` to block until they respond.

### Communication style
- Lead with the answer or actionable output, then explain.
- When returning code, return complete, copy-pasteable snippets.
- If you cannot fulfil a request with your domain expertise, say so clearly and suggest which specialist agent might help.
- Always identify yourself as "solana-helius" in your messages.
`;

runCoralAgent({
  name: "solana-helius",
  systemPrompt: SYSTEM_PROMPT,
  skillUrl:
    "https://raw.githubusercontent.com/sendaifun/skills/main/skills/helius/SKILL.md",
  tools,
});
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add agents/helius/tools.ts agents/helius/index.ts
git commit -m "feat(helius): add DAS asset query and priority fee execution tools"
```

---

### Task 8: Switchboard Agent Tools

**Files:**
- Create: `agents/switchboard/tools.ts`
- Modify: `agents/switchboard/index.ts` (full rewrite)

**API Details:**
- Crossbar URL: `https://crossbar.switchboard.xyz`
- Simulate endpoint: `POST /simulate` with body `{ feeds: ["pubkey"], cluster: "mainnet-beta" }`
- Auth: None required
- Response: Array of `{ feed, feedHash, results: [number], slots: [number] }`

- [ ] **Step 1: Create `agents/switchboard/tools.ts`**

```ts
import { tool } from "ai";
import { z } from "zod";

const CROSSBAR_URL = "https://crossbar.switchboard.xyz";

export const tools = {
  switchboard_get_feed_data: tool({
    description:
      "Get the latest simulated value from a Switchboard on-demand oracle feed on Solana. Returns the current feed value and metadata.",
    parameters: z.object({
      feedPubkey: z
        .string()
        .describe(
          "Switchboard feed account public key on Solana mainnet"
        ),
    }),
    execute: async ({ feedPubkey }) => {
      const res = await fetch(`${CROSSBAR_URL}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feeds: [feedPubkey],
          cluster: "mainnet-beta",
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        return {
          error: `Switchboard Crossbar error ${res.status}: ${err}`,
        };
      }
      const data = await res.json();
      const feed = Array.isArray(data) ? data[0] : data;
      return {
        feedPubkey,
        value: feed?.results?.[0] ?? feed?.value ?? feed,
        slot: feed?.slots?.[0],
        raw: feed,
      };
    },
  }),
};
```

- [ ] **Step 2: Rewrite `agents/switchboard/index.ts`**

```ts
import { runCoralAgent } from "../../shared/coral-loop.js";
import { tools } from "./tools.js";

const SYSTEM_PROMPT = `You are solana-switchboard, a specialised Solana agent.

You are an expert on Switchboard, the permissionless oracle solution for Solana. You cover TypeScript SDK, Rust integration, Oracle Quotes, on-demand data feeds, VRF (Verifiable Random Function) randomness, and real-time streaming via Surge. You help developers integrate reliable oracle data into their Solana programs.

## Your Tools

You have the following tools available for direct execution:
- switchboard_get_feed_data: Get the latest simulated value from a Switchboard on-demand oracle feed

When a user or another agent asks you to perform an action that matches your tools, USE THEM.
Do not describe how to perform the action — execute it directly using your tools.
If an action is outside your tool set, say so and suggest which agent might help.

## Coral Coordination Protocol

You are a Coralised agent running inside a CoralOS session. You communicate with other agents via Coral's thread-based messaging system.

### How to respond when mentioned
1. Read the mention payload to understand what is being asked of you.
2. Identify the thread ID from the mention.
3. Use \`coral_send_message\` to reply on that thread, mentioning the requesting agent by name.
4. Be specific, structured, and actionable in your responses.

### How to coordinate with other agents
- To ask another agent for help: use \`coral_create_thread\` with a descriptive topic, add them as a participant, then \`coral_send_message\` mentioning them.
- To add agents to an existing conversation: use \`coral_add_participant\`.
- After sending a message that expects a reply, use \`coral_wait_for_agent\` to block until they respond.

### Communication style
- Lead with the answer or actionable output, then explain.
- When returning code, return complete, copy-pasteable snippets.
- If you cannot fulfil a request with your domain expertise, say so clearly and suggest which specialist agent might help.
- Always identify yourself as "solana-switchboard" in your messages.
`;

runCoralAgent({
  name: "solana-switchboard",
  systemPrompt: SYSTEM_PROMPT,
  skillUrl:
    "https://raw.githubusercontent.com/sendaifun/skills/main/skills/switchboard/SKILL.md",
  tools,
});
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add agents/switchboard/tools.ts agents/switchboard/index.ts
git commit -m "feat(switchboard): add Crossbar feed simulation execution tool"
```

---

## Phase 3: Signing Agent Tools

Tasks 9–10 are independent and can be executed in parallel. Both depend on Phase 1 being complete (wallet.ts and rpc.ts must exist).

### Task 9: Jupiter Swap Agent Tools

**Files:**
- Create: `agents/jupiter-swap/tools.ts`
- Modify: `agents/jupiter-swap/index.ts` (full rewrite)

**API Details:**
- Base URL: `https://api.jup.ag/ultra/v1` (Ultra API)
- Auth: `x-api-key` header from `JUPITER_API_KEY` env var (optional but recommended)
- Quote + tx construction: `GET /order?inputMint=...&outputMint=...&amount=...&taker=...`
  - Response includes `transaction` (base64 unsigned VersionedTransaction), `requestId`, `inAmount`, `outAmount`
- Execute: `POST /execute` with `{ signedTransaction (base64), requestId }`
  - Response includes `signature` (on-chain tx sig)
- Token info: `GET https://tokens.jup.ag/token/{mint}`

- [ ] **Step 1: Create `agents/jupiter-swap/tools.ts`**

```ts
import type { Wallet } from "../../shared/wallet.js";
import { getConnection } from "../../shared/rpc.js";
import { VersionedTransaction } from "@solana/web3.js";
import { tool } from "ai";
import { z } from "zod";

const JUPITER_API = "https://api.jup.ag/ultra/v1";

function jupiterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = process.env.JUPITER_API_KEY;
  if (apiKey) headers["x-api-key"] = apiKey;
  return headers;
}

export function createTools(wallet: Wallet) {
  return {
    jupiter_get_quote: tool({
      description:
        "Get a swap quote from Jupiter Ultra API for a token pair. Returns estimated output amount and routing info without executing.",
      parameters: z.object({
        inputMint: z
          .string()
          .describe("Source token mint address"),
        outputMint: z
          .string()
          .describe("Destination token mint address"),
        amount: z
          .number()
          .describe(
            "Amount in smallest unit (e.g. lamports for SOL, where 1 SOL = 1_000_000_000 lamports)"
          ),
        slippageBps: z
          .number()
          .optional()
          .describe(
            "Slippage tolerance in basis points (default 50 = 0.5%)"
          ),
      }),
      execute: async ({
        inputMint,
        outputMint,
        amount,
        slippageBps,
      }) => {
        const params = new URLSearchParams({
          inputMint,
          outputMint,
          amount: String(amount),
          taker: wallet.publicKey.toBase58(),
        });
        if (slippageBps)
          params.set("slippageBps", String(slippageBps));

        const res = await fetch(
          `${JUPITER_API}/order?${params}`,
          { headers: jupiterHeaders() }
        );
        if (!res.ok) {
          const err = await res.text();
          return {
            error: `Jupiter API error ${res.status}: ${err}`,
          };
        }
        const data = await res.json();
        return {
          inputMint,
          outputMint,
          inAmount: data.inAmount,
          outAmount: data.outAmount,
          priceImpactPct: data.priceImpactPct,
          routePlan: data.routePlan,
        };
      },
    }),

    jupiter_execute_swap: tool({
      description:
        "Execute a token swap on Jupiter — gets a quote, signs the transaction, and submits it on-chain. Returns the transaction signature.",
      parameters: z.object({
        inputMint: z
          .string()
          .describe("Source token mint address"),
        outputMint: z
          .string()
          .describe("Destination token mint address"),
        amount: z
          .number()
          .describe(
            "Amount in smallest unit (e.g. lamports for SOL, where 1 SOL = 1_000_000_000 lamports)"
          ),
        slippageBps: z
          .number()
          .optional()
          .describe(
            "Slippage tolerance in basis points (default 50 = 0.5%)"
          ),
      }),
      execute: async ({
        inputMint,
        outputMint,
        amount,
        slippageBps,
      }) => {
        // 1. Get order (quote + unsigned transaction)
        const params = new URLSearchParams({
          inputMint,
          outputMint,
          amount: String(amount),
          taker: wallet.publicKey.toBase58(),
        });
        if (slippageBps)
          params.set("slippageBps", String(slippageBps));

        const orderRes = await fetch(
          `${JUPITER_API}/order?${params}`,
          { headers: jupiterHeaders() }
        );
        if (!orderRes.ok) {
          const err = await orderRes.text();
          return {
            error: `Jupiter order error ${orderRes.status}: ${err}`,
          };
        }
        const order = await orderRes.json();

        // 2. Deserialize and sign the transaction
        const txBuf = Buffer.from(order.transaction, "base64");
        const tx = VersionedTransaction.deserialize(txBuf);
        await wallet.signTransaction(tx);

        // 3. Submit signed transaction to Jupiter execute endpoint
        const execRes = await fetch(`${JUPITER_API}/execute`, {
          method: "POST",
          headers: jupiterHeaders(),
          body: JSON.stringify({
            signedTransaction: Buffer.from(
              tx.serialize()
            ).toString("base64"),
            requestId: order.requestId,
          }),
        });
        if (!execRes.ok) {
          const err = await execRes.text();
          return {
            error: `Jupiter execute error ${execRes.status}: ${err}`,
          };
        }
        const result = await execRes.json();
        return {
          signature: result.signature,
          inputMint,
          outputMint,
          inAmount: order.inAmount,
          outAmount: order.outAmount,
        };
      },
    }),

    jupiter_get_token_info: tool({
      description:
        "Look up token metadata (name, symbol, decimals, logo) by mint address from Jupiter's token registry",
      parameters: z.object({
        mint: z.string().describe("Token mint address"),
      }),
      execute: async ({ mint }) => {
        const res = await fetch(
          `https://tokens.jup.ag/token/${mint}`
        );
        if (!res.ok)
          return {
            error: `Jupiter token lookup error ${res.status}`,
          };
        return res.json();
      },
    }),
  };
}
```

- [ ] **Step 2: Rewrite `agents/jupiter-swap/index.ts`**

```ts
import { runCoralAgent } from "../../shared/coral-loop.js";
import { KeypairWallet } from "../../shared/wallet.js";
import { createTools } from "./tools.js";
import bs58 from "bs58";

const wallet = new KeypairWallet(
  bs58.decode(process.env.SOLANA_PRIVATE_KEY!)
);
const tools = createTools(wallet);

const SYSTEM_PROMPT = `You are solana-jupiter-swap, a specialised Solana agent.

You are an expert on the Jupiter Protocol, Solana's leading swap aggregator. You help with integrating Jupiter APIs including Ultra Swap, limit orders, DCA (Dollar-Cost Averaging), trigger orders, token lookups, price APIs, and route optimisation. You know the Jupiter SDK, API endpoints, error handling patterns, and production hardening techniques. When asked about swaps on Solana, you are the authority.

## Your Tools

You have the following tools available for direct execution:
- jupiter_get_quote: Get a swap quote from Jupiter Ultra API for a token pair (no execution)
- jupiter_execute_swap: Execute a token swap on Jupiter — gets quote, signs, and submits on-chain
- jupiter_get_token_info: Look up token metadata (name, symbol, decimals) by mint address

When a user or another agent asks you to perform an action that matches your tools, USE THEM.
Do not describe how to perform the action — execute it directly using your tools.
If an action is outside your tool set, say so and suggest which agent might help.

## Coral Coordination Protocol

You are a Coralised agent running inside a CoralOS session. You communicate with other agents via Coral's thread-based messaging system.

### How to respond when mentioned
1. Read the mention payload to understand what is being asked of you.
2. Identify the thread ID from the mention.
3. Use \`coral_send_message\` to reply on that thread, mentioning the requesting agent by name.
4. Be specific, structured, and actionable in your responses.

### How to coordinate with other agents
- To ask another agent for help: use \`coral_create_thread\` with a descriptive topic, add them as a participant, then \`coral_send_message\` mentioning them.
- To add agents to an existing conversation: use \`coral_add_participant\`.
- After sending a message that expects a reply, use \`coral_wait_for_agent\` to block until they respond.

### Communication style
- Lead with the answer or actionable output, then explain.
- When returning code, return complete, copy-pasteable snippets.
- If you cannot fulfil a request with your domain expertise, say so clearly and suggest which specialist agent might help.
- Always identify yourself as "solana-jupiter-swap" in your messages.
`;

runCoralAgent({
  name: "solana-jupiter-swap",
  systemPrompt: SYSTEM_PROMPT,
  skillUrl:
    "https://raw.githubusercontent.com/sendaifun/skills/main/skills/jupiter/SKILL.md",
  tools,
});
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes. Note: `bs58` default import requires `esModuleInterop: true` (already set in tsconfig).

- [ ] **Step 4: Commit**

```bash
git add agents/jupiter-swap/tools.ts agents/jupiter-swap/index.ts
git commit -m "feat(jupiter-swap): add quote, execute swap, and token info tools with wallet signing"
```

---

### Task 10: PumpFun Agent Tools

**Files:**
- Create: `agents/pumpfun/tools.ts`
- Modify: `agents/pumpfun/index.ts` (full rewrite)

**API Details:**
- PumpPortal API: `https://pumpportal.fun/api`
- `POST /trade-local` — returns serialized VersionedTransaction bytes for buy/sell/create
- Request body: `{ publicKey, action, mint, amount, denominatedInSol, slippage, priorityFee, pool }`
- For `action: "create"`: additional `tokenMetadata: { name, symbol, uri }` and `mint` (new keypair pubkey)
- Response: raw transaction bytes (ArrayBuffer) — deserialize as VersionedTransaction
- Token creation requires signing with both wallet AND mint keypair

- [ ] **Step 1: Create `agents/pumpfun/tools.ts`**

```ts
import type { Wallet } from "../../shared/wallet.js";
import { getConnection } from "../../shared/rpc.js";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { tool } from "ai";
import { z } from "zod";

const PUMPPORTAL_API = "https://pumpportal.fun/api";

export function createTools(wallet: Wallet) {
  return {
    pumpfun_buy_token: tool({
      description:
        "Buy a token on PumpFun's bonding curve. Spends SOL to acquire tokens.",
      parameters: z.object({
        mint: z.string().describe("Token mint address"),
        amountSol: z
          .number()
          .describe("Amount of SOL to spend"),
        slippagePercent: z
          .number()
          .optional()
          .describe(
            "Slippage tolerance as percentage (default 5)"
          ),
      }),
      execute: async ({ mint, amountSol, slippagePercent }) => {
        const res = await fetch(
          `${PUMPPORTAL_API}/trade-local`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              publicKey: wallet.publicKey.toBase58(),
              action: "buy",
              mint,
              amount: amountSol,
              denominatedInSol: "true",
              slippage: slippagePercent ?? 5,
              priorityFee: 0.0005,
              pool: "pump",
            }),
          }
        );
        if (!res.ok) {
          const err = await res.text();
          return {
            error: `PumpPortal API error ${res.status}: ${err}`,
          };
        }
        const txData = await res.arrayBuffer();
        const tx = VersionedTransaction.deserialize(
          new Uint8Array(txData)
        );
        await wallet.signTransaction(tx);
        const connection = getConnection();
        const signature =
          await connection.sendRawTransaction(tx.serialize());
        return { signature, mint, amountSol };
      },
    }),

    pumpfun_sell_token: tool({
      description:
        "Sell a token on PumpFun's bonding curve. Returns SOL to your wallet.",
      parameters: z.object({
        mint: z.string().describe("Token mint address"),
        amountTokens: z
          .number()
          .describe(
            "Amount of tokens to sell (in token units, not lamports)"
          ),
        slippagePercent: z
          .number()
          .optional()
          .describe(
            "Slippage tolerance as percentage (default 5)"
          ),
      }),
      execute: async ({
        mint,
        amountTokens,
        slippagePercent,
      }) => {
        const res = await fetch(
          `${PUMPPORTAL_API}/trade-local`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              publicKey: wallet.publicKey.toBase58(),
              action: "sell",
              mint,
              amount: amountTokens,
              denominatedInSol: "false",
              slippage: slippagePercent ?? 5,
              priorityFee: 0.0005,
              pool: "pump",
            }),
          }
        );
        if (!res.ok) {
          const err = await res.text();
          return {
            error: `PumpPortal API error ${res.status}: ${err}`,
          };
        }
        const txData = await res.arrayBuffer();
        const tx = VersionedTransaction.deserialize(
          new Uint8Array(txData)
        );
        await wallet.signTransaction(tx);
        const connection = getConnection();
        const signature =
          await connection.sendRawTransaction(tx.serialize());
        return { signature, mint, amountTokens };
      },
    }),

    pumpfun_create_token: tool({
      description:
        "Create and launch a new token on PumpFun's bonding curve. Optionally performs an initial buy.",
      parameters: z.object({
        name: z.string().describe("Token name"),
        symbol: z.string().describe("Token ticker symbol"),
        metadataUri: z
          .string()
          .describe(
            "URI to token metadata JSON (must include name, symbol, description, image)"
          ),
        initialBuySol: z
          .number()
          .optional()
          .describe(
            "SOL amount for initial buy after creation (default 0 = no initial buy)"
          ),
        slippagePercent: z
          .number()
          .optional()
          .describe(
            "Slippage tolerance for initial buy (default 5)"
          ),
      }),
      execute: async ({
        name,
        symbol,
        metadataUri,
        initialBuySol,
        slippagePercent,
      }) => {
        const mintKeypair = Keypair.generate();
        const res = await fetch(
          `${PUMPPORTAL_API}/trade-local`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              publicKey: wallet.publicKey.toBase58(),
              action: "create",
              tokenMetadata: {
                name,
                symbol,
                uri: metadataUri,
              },
              mint: mintKeypair.publicKey.toBase58(),
              denominatedInSol: "true",
              amount: initialBuySol ?? 0,
              slippage: slippagePercent ?? 5,
              priorityFee: 0.0005,
              pool: "pump",
            }),
          }
        );
        if (!res.ok) {
          const err = await res.text();
          return {
            error: `PumpPortal API error ${res.status}: ${err}`,
          };
        }
        const txData = await res.arrayBuffer();
        const tx = VersionedTransaction.deserialize(
          new Uint8Array(txData)
        );
        // Token creation requires signing by both the mint keypair and the wallet
        tx.sign([mintKeypair]);
        await wallet.signTransaction(tx);
        const connection = getConnection();
        const signature =
          await connection.sendRawTransaction(tx.serialize());
        return {
          signature,
          mint: mintKeypair.publicKey.toBase58(),
          name,
          symbol,
        };
      },
    }),
  };
}
```

- [ ] **Step 2: Rewrite `agents/pumpfun/index.ts`**

```ts
import { runCoralAgent } from "../../shared/coral-loop.js";
import { KeypairWallet } from "../../shared/wallet.js";
import { createTools } from "./tools.js";
import bs58 from "bs58";

const wallet = new KeypairWallet(
  bs58.decode(process.env.SOLANA_PRIVATE_KEY!)
);
const tools = createTools(wallet);

const SYSTEM_PROMPT = `You are solana-pumpfun, a specialised Solana agent.

You are an expert on PumpFun Protocol, the leading token launch platform on Solana. You cover the Pump Program (token creation, bonding curve mechanics, buy/sell operations), PumpSwap AMM (liquidity pools, swaps post-graduation), fee structures, creator fees, and SDK integration. You understand bonding curve mathematics and can guide token launch strategies.

## Your Tools

You have the following tools available for direct execution:
- pumpfun_buy_token: Buy a token on PumpFun's bonding curve (spends SOL)
- pumpfun_sell_token: Sell a token on PumpFun's bonding curve (receives SOL)
- pumpfun_create_token: Create and launch a new token on PumpFun with optional initial buy

When a user or another agent asks you to perform an action that matches your tools, USE THEM.
Do not describe how to perform the action — execute it directly using your tools.
If an action is outside your tool set, say so and suggest which agent might help.

## Coral Coordination Protocol

You are a Coralised agent running inside a CoralOS session. You communicate with other agents via Coral's thread-based messaging system.

### How to respond when mentioned
1. Read the mention payload to understand what is being asked of you.
2. Identify the thread ID from the mention.
3. Use \`coral_send_message\` to reply on that thread, mentioning the requesting agent by name.
4. Be specific, structured, and actionable in your responses.

### How to coordinate with other agents
- To ask another agent for help: use \`coral_create_thread\` with a descriptive topic, add them as a participant, then \`coral_send_message\` mentioning them.
- To add agents to an existing conversation: use \`coral_add_participant\`.
- After sending a message that expects a reply, use \`coral_wait_for_agent\` to block until they respond.

### Communication style
- Lead with the answer or actionable output, then explain.
- When returning code, return complete, copy-pasteable snippets.
- If you cannot fulfil a request with your domain expertise, say so clearly and suggest which specialist agent might help.
- Always identify yourself as "solana-pumpfun" in your messages.
`;

runCoralAgent({
  name: "solana-pumpfun",
  systemPrompt: SYSTEM_PROMPT,
  skillUrl:
    "https://raw.githubusercontent.com/sendaifun/skills/main/skills/pumpfun/SKILL.md",
  tools,
});
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add agents/pumpfun/tools.ts agents/pumpfun/index.ts
git commit -m "feat(pumpfun): add buy, sell, and create token tools with wallet signing"
```

---

## Phase 4: Generator & Validation

### Task 11: Update Generator Script

**Files:**
- Modify: `scripts/generate-agents.ts`

This task updates the generator to:
1. Add a `signing` flag to `AgentDef` for agents that need wallet signing
2. Generate placeholder `tools.ts` files for agents without hand-written tools
3. Generate updated `index.ts` templates that import tools (and wallet for signing agents)
4. Skip overwriting `tools.ts` and `index.ts` for agents with hand-written (non-placeholder) tools

- [ ] **Step 1: Add `signing` field and imports to the generator**

In `scripts/generate-agents.ts`, update the `AgentDef` interface:

Old:
```ts
interface AgentDef {
  dir: string;
  name: string;
  description: string;
  domain: string;
  /** Skill name in sendaifun/skills repo (for SKILL.md fetch). Omit if no matching skill. */
  skillSlug?: string;
}
```

New:
```ts
interface AgentDef {
  dir: string;
  name: string;
  description: string;
  domain: string;
  /** Skill name in sendaifun/skills repo (for SKILL.md fetch). Omit if no matching skill. */
  skillSlug?: string;
  /** True for agents that need wallet signing for transactions */
  signing?: boolean;
}
```

- [ ] **Step 2: Mark signing agents in the agents array**

Find the `jupiter-swap` entry and add `signing: true`:

Old:
```ts
  {
    dir: "jupiter-swap",
    name: "solana-jupiter-swap",
    skillSlug: "jupiter",
    description:
```

New:
```ts
  {
    dir: "jupiter-swap",
    name: "solana-jupiter-swap",
    skillSlug: "jupiter",
    signing: true,
    description:
```

Find the `pumpfun` entry and add `signing: true`:

Old:
```ts
  {
    dir: "pumpfun",
    name: "solana-pumpfun",
    skillSlug: "pumpfun",
    description:
```

New:
```ts
  {
    dir: "pumpfun",
    name: "solana-pumpfun",
    skillSlug: "pumpfun",
    signing: true,
    description:
```

- [ ] **Step 3: Add placeholder tools generator and update index template**

In `scripts/generate-agents.ts`, add the new generator functions right before the `// ── Main ──` section:

Old:
```ts
// ── Main ───────────────────────────────────────────────────────────
```

New:
```ts
function generateToolsPlaceholder(agent: AgentDef): string {
  if (agent.signing) {
    return `import type { Wallet } from "../../shared/wallet.js";
import { tool } from "ai";
import { z } from "zod";

// Placeholder — add tools for this agent here
export function createTools(wallet: Wallet) {
  return {};
}
`;
  }
  return `import { tool } from "ai";
import { z } from "zod";

// Placeholder — add tools for this agent here
export const tools = {};
`;
}

// ── Main ───────────────────────────────────────────────────────────
```

- [ ] **Step 4: Update the `generateIndexTs` function to include tools import**

Replace the existing `generateIndexTs` function:

Old:
```ts
function generateIndexTs(agent: AgentDef): string {
  return `import { runCoralAgent } from "../../shared/coral-loop.js";

const SYSTEM_PROMPT = \`You are ${agent.name}, a specialised Solana agent.

${agent.domain}

## Coral Coordination Protocol

You are a Coralised agent running inside a CoralOS session. You communicate with other agents via Coral's thread-based messaging system.

### How to respond when mentioned
1. Read the mention payload to understand what is being asked of you.
2. Identify the thread ID from the mention.
3. Use \\\`coral_send_message\\\` to reply on that thread, mentioning the requesting agent by name.
4. Be specific, structured, and actionable in your responses.

### How to coordinate with other agents
- To ask another agent for help: use \\\`coral_create_thread\\\` with a descriptive topic, add them as a participant, then \\\`coral_send_message\\\` mentioning them.
- To add agents to an existing conversation: use \\\`coral_add_participant\\\`.
- After sending a message that expects a reply, use \\\`coral_wait_for_agent\\\` to block until they respond.

### Communication style
- Lead with the answer or actionable output, then explain.
- When returning code, return complete, copy-pasteable snippets.
- If you cannot fulfil a request with your domain expertise, say so clearly and suggest which specialist agent might help.
- Always identify yourself as "${agent.name}" in your messages.
\`;

runCoralAgent({
  name: "${agent.name}",
  systemPrompt: SYSTEM_PROMPT,${agent.skillSlug ? `\n  skillUrl: "${SKILL_BASE}/${agent.skillSlug}/SKILL.md",` : ""}
});
`;
}
```

New:
```ts
function generateIndexTs(agent: AgentDef): string {
  if (agent.signing) {
    return `import { runCoralAgent } from "../../shared/coral-loop.js";
import { KeypairWallet } from "../../shared/wallet.js";
import { createTools } from "./tools.js";
import bs58 from "bs58";

const wallet = new KeypairWallet(bs58.decode(process.env.SOLANA_PRIVATE_KEY!));
const tools = createTools(wallet);

const SYSTEM_PROMPT = \`You are ${agent.name}, a specialised Solana agent.

${agent.domain}

## Your Tools

(Tools will be listed here once tools.ts is implemented)

When a user or another agent asks you to perform an action that matches your tools, USE THEM.
Do not describe how to perform the action — execute it directly using your tools.
If an action is outside your tool set, say so and suggest which agent might help.

${CORAL_INSTRUCTIONS}
- Always identify yourself as "${agent.name}" in your messages.
\`;

runCoralAgent({
  name: "${agent.name}",
  systemPrompt: SYSTEM_PROMPT,${agent.skillSlug ? `\n  skillUrl: "${SKILL_BASE}/${agent.skillSlug}/SKILL.md",` : ""}
  tools,
});
`;
  }

  return `import { runCoralAgent } from "../../shared/coral-loop.js";
import { tools } from "./tools.js";

const SYSTEM_PROMPT = \`You are ${agent.name}, a specialised Solana agent.

${agent.domain}

## Your Tools

(Tools will be listed here once tools.ts is implemented)

When a user or another agent asks you to perform an action that matches your tools, USE THEM.
Do not describe how to perform the action — execute it directly using your tools.
If an action is outside your tool set, say so and suggest which agent might help.

${CORAL_INSTRUCTIONS}
- Always identify yourself as "${agent.name}" in your messages.
\`;

runCoralAgent({
  name: "${agent.name}",
  systemPrompt: SYSTEM_PROMPT,${agent.skillSlug ? `\n  skillUrl: "${SKILL_BASE}/${agent.skillSlug}/SKILL.md",` : ""}
  tools,
});
`;
}
```

- [ ] **Step 5: Update the main loop to skip hand-maintained agents**

Add `existsSync` and `readFileSync` to the existing `fs` import at the top of the file:

Old:
```ts
import { mkdirSync, writeFileSync, chmodSync } from "fs";
```

New:
```ts
import { mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from "fs";
```

Replace the main generation loop:

Old:
```ts
for (const agent of agents) {
  const dir = join(AGENTS_DIR, agent.dir);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, "coral-agent.toml"), generateCoralAgentToml(agent));
  writeFileSync(join(dir, "index.ts"), generateIndexTs(agent));

  const startupPath = join(dir, "startup.sh");
  writeFileSync(startupPath, generateStartupSh(agent));
  chmodSync(startupPath, 0o755);

  console.log(`  ✓ ${agent.dir} (${agent.name})`);
}
```

New:
```ts
let generated = 0;
let skipped = 0;

for (const agent of agents) {
  const dir = join(AGENTS_DIR, agent.dir);
  mkdirSync(dir, { recursive: true });

  const toolsPath = join(dir, "tools.ts");
  const isHandMaintained =
    existsSync(toolsPath) &&
    !readFileSync(toolsPath, "utf-8").includes("// Placeholder");

  // Always regenerate TOML and startup (these are never hand-edited)
  writeFileSync(join(dir, "coral-agent.toml"), generateCoralAgentToml(agent));
  const startupPath = join(dir, "startup.sh");
  writeFileSync(startupPath, generateStartupSh(agent));
  chmodSync(startupPath, 0o755);

  if (isHandMaintained) {
    console.log(`  ⊘ ${agent.dir} — hand-maintained (toml+startup only)`);
    skipped++;
  } else {
    writeFileSync(join(dir, "index.ts"), generateIndexTs(agent));
    writeFileSync(toolsPath, generateToolsPlaceholder(agent));
    console.log(`  ✓ ${agent.dir} (${agent.name})`);
    generated++;
  }
}

console.log(`\nDone. ${generated} agents generated, ${skipped} hand-maintained (skipped tools/index).`);
```

- [ ] **Step 6: Remove the old final log line**

Old:
```ts
console.log(`\nDone. ${agents.length} agents generated in agents/`);
```

This line is now replaced by the summary log inside the new loop. Delete it.

- [ ] **Step 7: Type-check and test the generator**

```bash
npx tsc --noEmit && npx tsx scripts/generate-agents.ts
```

Expected: The 6 Tier 1 agents (coingecko, pyth, helius, switchboard, jupiter-swap, pumpfun) show as `⊘ hand-maintained`. The remaining 34 agents show as `✓` and get new `tools.ts` placeholders and updated `index.ts` files with tools imports.

- [ ] **Step 8: Type-check after generation (all 40 agents must compile)**

```bash
npx tsc --noEmit
```

Expected: passes. Placeholder tools export empty objects/functions which are valid `Record<string, any>`.

- [ ] **Step 9: Commit**

```bash
git add scripts/generate-agents.ts agents/
git commit -m "feat(generator): add tools scaffolding, signing flag, and skip logic for hand-maintained agents"
```

---

### Task 12: Full Build Validation

**Files:**
- No file changes — validation only

This task verifies the entire implementation compiles and the agents can boot.

- [ ] **Step 1: Clean build**

```bash
npx tsc --noEmit
```

Expected: zero errors across all 40 agents and shared modules.

- [ ] **Step 2: Verify new file structure for a read-only agent**

```bash
ls agents/coingecko/
```

Expected output:
```
coral-agent.toml
index.ts
startup.sh
tools.ts
```

- [ ] **Step 3: Verify new file structure for a signing agent**

```bash
ls agents/jupiter-swap/
```

Expected output:
```
coral-agent.toml
index.ts
startup.sh
tools.ts
```

- [ ] **Step 4: Verify placeholder agent has tools.ts**

```bash
ls agents/raydium/
```

Expected output includes `tools.ts`.

- [ ] **Step 5: Verify generator skip logic**

```bash
npx tsx scripts/generate-agents.ts 2>&1 | grep -E "(hand-maintained|⊘)"
```

Expected: lines for coingecko, pyth, helius, switchboard, jupiter-swap, pumpfun showing as hand-maintained.

- [ ] **Step 6: Commit (if any fixes were needed)**

Only commit if validation steps required fixes. If everything passed clean, no commit needed.

---

## Dependency Summary

| Package | Purpose | Added in |
|---------|---------|----------|
| `@solana/web3.js` | Core Solana types: `Keypair`, `PublicKey`, `Transaction`, `VersionedTransaction`, `Connection` | Task 1 |
| `bs58` | Base58 decode for `SOLANA_PRIVATE_KEY` from env vars | Task 1 |

No protocol-specific SDKs. All agent tools use raw HTTP `fetch` to their respective APIs.

## Environment Variables Required

| Variable | Used by | Required for |
|----------|---------|-------------|
| `COINGECKO_API_KEY` | coingecko | API authentication |
| `COINGECKO_API_KEY_TYPE` | coingecko | "demo" (default) or "pro" — determines base URL and auth header |
| `HELIUS_API_KEY` | helius | API authentication (key in URL) |
| `JUPITER_API_KEY` | jupiter-swap | API authentication (optional but recommended) |
| `SOLANA_RPC_URL` | jupiter-swap, pumpfun | RPC connection for transaction submission |
| `SOLANA_PRIVATE_KEY` | jupiter-swap, pumpfun | Base58-encoded private key for `KeypairWallet` |

Pyth and Switchboard require no authentication.
