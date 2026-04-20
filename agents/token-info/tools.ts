import { createRequire } from "node:module";

import type { AgentTool } from "@mariozechner/pi-agent-core";

import { adaptAgentKitActions } from "../../src/agent-kit/adapter.js";
import type {
  AgentKitAction,
  AgentKitAgent,
} from "../../src/agent-kit/types.js";

const require = createRequire(import.meta.url);

interface AgentKitBundle {
  KeypairWallet: new (keypair: unknown, rpcUrl: string) => unknown;
  SolanaAgentKit: new (
    wallet: unknown,
    rpcUrl: string,
    config: Record<string, unknown>
  ) => AgentKitAgent & {
    actions: AgentKitAction[];
    use: (plugin: unknown) => unknown;
  };
}

const COINGECKO_ALLOWLIST = ["GET_COINGECKO_TOKEN_INFO_ACTION"];

const PLUGIN_BY_ACTION: Record<string, string> = Object.fromEntries(
  COINGECKO_ALLOWLIST.map((a) => [a, "@solana-agent-kit/plugin-misc"])
);

export interface BuildToolsResult {
  tools: AgentTool<any>[];
  secretsFromEnv: string[];
}

export function buildTokenInfoTools(): BuildToolsResult {
  const coingeckoKey = process.env.COINGECKO_API_KEY;
  if (!coingeckoKey) {
    throw new Error(
      "Missing COINGECKO_API_KEY — declared as a coral-agent.toml option."
    );
  }
  const rpcUrl =
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

  const sak = require("solana-agent-kit") as AgentKitBundle;
  const { Keypair } = require("@solana/web3.js") as {
    Keypair: { generate: () => unknown };
  };
  const wallet = new sak.KeypairWallet(Keypair.generate(), rpcUrl);

  let agent = new sak.SolanaAgentKit(wallet, rpcUrl, {
    COINGECKO_PRO_API_KEY: coingeckoKey,
  }) as unknown as {
    actions: AgentKitAction[];
    use: (plugin: unknown) => typeof agent;
  };
  const miscPlugin = require("@solana-agent-kit/plugin-misc");
  agent = agent.use(miscPlugin.default ?? miscPlugin);

  const secretsFromEnv = [coingeckoKey, process.env.MODEL_API_KEY ?? ""].filter(
    (s) => s.length > 0
  );

  const tools = adaptAgentKitActions({
    registry: agent.actions,
    allowlist: COINGECKO_ALLOWLIST,
    agent: agent as unknown as AgentKitAgent,
    pluginByAction: PLUGIN_BY_ACTION,
    secretsFromEnv,
  });

  return { tools, secretsFromEnv };
}
