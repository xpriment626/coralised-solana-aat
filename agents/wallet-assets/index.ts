import { runAtom } from "pi-coral-agent";

import { buildWalletAssetsTools } from "./tools.js";

const { tools, secretsFromEnv } = buildWalletAssetsTools();

runAtom({ tools, secretsFromEnv }).catch((err) => {
  console.error("[wallet-assets] fatal:", err);
  process.exit(1);
});
