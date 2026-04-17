// Type aliases re-exported from SendAI Agent Kit. Source inspected:
// node_modules/solana-agent-kit/dist/index.d.ts (v2.0.10).
//
// The adapter consumes Agent Kit's registered actions (populated via
// `agent.use(plugin)`) and projects a subset into the atom runtime's
// LocalToolRegistry. The interface below is a structural copy of the
// Agent Kit Action type — re-declared here (not imported) to avoid
// accidental tight coupling if Agent Kit's upstream shape shifts.
//
// Action names the adapter must handle (from src/atoms/market-data.ts):
//   market-trends   : GET_COINGECKO_TRENDING_TOKENS_ACTION
//                     GET_COINGECKO_TRENDING_POOLS_ACTION
//                     GET_COINGECKO_TOP_GAINERS
//                     GET_COINGECKO_LATEST_POOLS
//   token-info      : GET_COINGECKO_TOKEN_INFO_ACTION
//   market-price    : GET_COINGECKO_TOKEN_PRICE_DATA_ACTION
//   oracle-price    : PYTH_FETCH_PRICE
//   wallet-assets   : FETCH_ASSETS_BY_OWNER

import type { z } from "zod";
import type { SolanaAgentKit } from "solana-agent-kit";

export type AgentKitAgent = SolanaAgentKit;

export interface AgentKitAction {
  name: string;
  description?: string;
  schema?: z.ZodType<unknown>;
  handler: (
    agent: AgentKitAgent,
    input: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
}

export type AgentKitActionRegistry = AgentKitAction[];
