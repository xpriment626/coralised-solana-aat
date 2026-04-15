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
