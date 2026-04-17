import { createRequire } from "node:module";

import { adaptAgentKitActions } from "../agent-kit/adapter.js";
import type { AgentKitAction, AgentKitAgent } from "../agent-kit/types.js";
import { startAtom } from "../runtime/atom-template.js";

import { marketDataAtoms } from "./market-data.js";
import type { AtomActionRef, AtomManifest } from "./manifest.js";

// Agent Kit plugins pull in transitive packages (e.g. @bonfida/spl-name-service)
// that have broken ESM module resolution on Node 22+. Loading them through
// createRequire forces CJS resolution, which is more forgiving and lets the
// read-only market-data atoms run without patching upstream packages.
const require = createRequire(import.meta.url);

interface AgentKitBundle {
  KeypairWallet: new (keypair: unknown, rpcUrl: string) => unknown;
  SolanaAgentKit: new (
    wallet: unknown,
    rpcUrl: string,
    config: Record<string, unknown>
  ) => AgentKitAgent & {
    actions: AgentKitAction[];
    use: (plugin: unknown) => AgentKitBundle["SolanaAgentKit"]["prototype"];
  };
}

function loadAgentKit(): AgentKitBundle {
  return require("solana-agent-kit") as AgentKitBundle;
}

function loadPluginByPackage(pkg: string): unknown {
  const mod = require(pkg);
  return mod.default ?? mod;
}

export interface BootstrapParams {
  atomName: string;
}

function findManifest(atomName: string): AtomManifest {
  const found = marketDataAtoms.find((a) => a.name === atomName);
  if (!found) {
    throw new Error(
      `Unknown atom "${atomName}". Expected one of: ${marketDataAtoms
        .map((a) => a.name)
        .join(", ")}.`
    );
  }
  return found;
}

function pluginPackagesForManifest(manifest: AtomManifest): string[] {
  const seen = new Set<string>();
  const packages: string[] = [];
  for (const action of manifest.actions) {
    if (!seen.has(action.packageName)) {
      seen.add(action.packageName);
      packages.push(action.packageName);
    }
  }
  return packages;
}

function pluginByAction(manifest: AtomManifest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const action of manifest.actions) {
    out[action.actionName] = action.packageName;
  }
  return out;
}

interface RequiredCredentials {
  rpcUrl: string;
  coingeckoKey?: string;
  heliusKey?: string;
}

function readCredentials(manifest: AtomManifest): RequiredCredentials {
  const rpcUrl =
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const missing: string[] = [];

  const needsCoingecko = manifest.actions.some((a: AtomActionRef) =>
    a.actionName.startsWith("GET_COINGECKO_")
  );
  const needsHelius = manifest.actions.some(
    (a: AtomActionRef) => a.actionName === "FETCH_ASSETS_BY_OWNER"
  );

  let coingeckoKey: string | undefined;
  if (needsCoingecko) {
    coingeckoKey = process.env.COINGECKO_API_KEY;
    if (!coingeckoKey) missing.push("COINGECKO_API_KEY");
  }

  let heliusKey: string | undefined;
  if (needsHelius) {
    heliusKey = process.env.HELIUS_API_KEY;
    if (!heliusKey) missing.push("HELIUS_API_KEY");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required credentials for atom "${manifest.name}": ${missing.join(", ")}. ` +
        `These are declared as coral-agent.toml options so Coral Console can supply them.`
    );
  }

  return { rpcUrl, coingeckoKey, heliusKey };
}

function buildAgent(
  creds: RequiredCredentials,
  packages: string[]
): AgentKitAgent & { actions: AgentKitAction[] } {
  const sak = loadAgentKit();
  const { Keypair } = require("@solana/web3.js") as {
    Keypair: { generate: () => unknown };
  };
  const keypair = Keypair.generate();
  const wallet = new sak.KeypairWallet(keypair, creds.rpcUrl);
  let agent = new sak.SolanaAgentKit(wallet, creds.rpcUrl, {
    COINGECKO_PRO_API_KEY: creds.coingeckoKey,
    HELIUS_API_KEY: creds.heliusKey,
  }) as unknown as {
    actions: AgentKitAction[];
    use: (plugin: unknown) => typeof agent;
  };

  for (const pkg of packages) {
    const plugin = loadPluginByPackage(pkg);
    agent = agent.use(plugin);
  }

  return agent as unknown as AgentKitAgent & { actions: AgentKitAction[] };
}

export async function bootstrapAtom(params: BootstrapParams): Promise<void> {
  const manifest = findManifest(params.atomName);
  const creds = readCredentials(manifest);
  const agent = buildAgent(creds, pluginPackagesForManifest(manifest));

  const allowlist = manifest.actions.map((a) => a.actionName);
  const tools = adaptAgentKitActions({
    registry: agent.actions,
    allowlist,
    agent,
    pluginByAction: pluginByAction(manifest),
    secretsFromEnv: [
      creds.coingeckoKey ?? "",
      creds.heliusKey ?? "",
      process.env.MODEL_API_KEY ?? "",
    ].filter(Boolean),
  });

  await startAtom({ atomName: params.atomName, tools });
}
