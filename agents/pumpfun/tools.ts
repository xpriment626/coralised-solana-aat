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
