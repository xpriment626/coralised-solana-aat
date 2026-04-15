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
